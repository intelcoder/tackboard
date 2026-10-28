import { test } from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { brand } from "@app/shared";
import { createOverlaySwitch } from "../src/overlay_switch.ts";

function setup(on: boolean, body = "") {
  const document = parseHTML(`<html><body>${body}</body></html>`).document as unknown as Document;
  const state = { on, mounted: 0, destroyed: 0 };
  const overlay = createOverlaySwitch({
    document,
    isOn: async () => state.on,
    mount: () => {
      state.mounted++;
      const host = document.createElement("div");
      host.id = brand.hostId;
      document.body.append(host);
      return { destroy: () => { state.destroyed++; host.remove(); } };
    },
  });
  return { document, state, overlay };
}

test("on and no overlay in the page mounts once, a second refresh does not mount again", async () => {
  const { state, overlay } = setup(true);
  await overlay.refresh();
  await overlay.refresh();
  assert.equal(state.mounted, 1);
});

test("a page that already has the overlay host is never given a second one", async () => {
  const { state, overlay } = setup(true, `<div id="${brand.hostId}"></div>`);
  await overlay.refresh();
  assert.equal(state.mounted, 0);
});

test("off after on destroys it, and on again mounts it", async () => {
  const { state, overlay } = setup(true);
  await overlay.refresh();
  state.on = false;
  await overlay.refresh();
  assert.equal(state.destroyed, 1);
  state.on = true;
  await overlay.refresh();
  assert.equal(state.mounted, 2);
});

test("off at the start never mounts", async () => {
  const { state, overlay } = setup(false);
  await overlay.refresh();
  assert.equal(state.mounted, 0);
  assert.equal(state.destroyed, 0);
});
