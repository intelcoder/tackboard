import { test } from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { brand } from "@app/shared";
import type { ElementRef, ThreadDto } from "@app/shared";
import { buildElementRef } from "../src/element_ref.ts";
import { mountOverlay } from "../src/index.ts";

type Rect = { left: number; top: number; width: number; height: number };

function setRect(el: Element, r: Rect) {
  (el as any).getBoundingClientRect = () => ({
    x: r.left, y: r.top, left: r.left, top: r.top, width: r.width, height: r.height,
    right: r.left + r.width, bottom: r.top + r.height,
  });
}

function setup(body: string, onPick?: (ref: ElementRef, el: Element) => void) {
  const parsed = parseHTML(`<html><body>${body}</body></html>`);
  const document = parsed.document as unknown as Document;
  const win = parsed.window as any;
  const overlay = mountOverlay({
    document,
    window: win,
    config: { base: "http://127.0.0.1:1", token: "t" },
    viewport: () => ({ w: 800, h: 600 }),
    onPick,
  });
  const fire = (target: EventTarget, type: string, extra: Record<string, unknown> = {}) => {
    const ev = new parsed.Event(type, { bubbles: true, composed: true, cancelable: true }) as any;
    Object.assign(ev, extra);
    target.dispatchEvent(ev);
    return ev as Event;
  };
  return { document, win, overlay, root: overlay.root as ParentNode, fire, Event: parsed.Event as any };
}

function thread(n: number, el: Element, status: ThreadDto["status"] = "pending"): ThreadDto {
  return {
    id: `t${n}`, n, branch: "main", commit: "abc", url: "http://x/", viewport: { w: 800, h: 600 },
    element: buildElementRef(el), status, openedBy: "user", unread: false, discarded: false,
    claimStale: false, messages: [{ id: "m1", author: "user", text: "hi", at: 1, discarded: false }],
  };
}

test("hidden mode renders no pins, outline or crumbs", () => {
  const s = setup(`<div id="a"><button id="b">Go</button></div>`);
  const b = s.document.getElementById("b")!;
  setRect(b, { left: 10, top: 10, width: 50, height: 20 });
  s.overlay.store.set({ threads: [thread(1, b)], mode: "comment" });
  s.fire(b, "mousemove");
  assert.ok(s.root.querySelector(".tb-pin"), "pin in comment mode");
  assert.ok(s.root.querySelector(".tb-outline"), "outline in comment mode");
  assert.ok(s.root.querySelector(".tb-crumbs"), "crumbs in comment mode");

  s.overlay.store.set({ mode: "hidden" });
  s.fire(b, "mousemove");
  assert.equal(s.root.querySelector(".tb-pin"), null);
  assert.equal(s.root.querySelector(".tb-outline"), null);
  assert.equal(s.root.querySelector(".tb-crumbs"), null);
  assert.ok(s.root.querySelector(".tb-modes"), "the ModeSwitch stays");

  s.overlay.store.set({ mode: "view" });
  assert.ok(s.root.querySelector(".tb-pin"), "pins return in view mode");
  assert.equal(s.root.querySelector(".tb-outline"), null, "no outline outside comment mode");
});

test("a pin is not rendered while its element is off screen", () => {
  const s = setup(`<p id="a">a</p><p id="b">b</p>`);
  const a = s.document.getElementById("a")!;
  const b = s.document.getElementById("b")!;
  setRect(a, { left: 100, top: 100, width: 40, height: 20 });
  setRect(b, { left: 100, top: 5000, width: 40, height: 20 });
  s.overlay.store.set({ threads: [thread(1, a), thread(2, b)] });
  const pins = () => [...s.root.querySelectorAll(".tb-pin")] as HTMLElement[];
  assert.equal(pins().length, 1);
  assert.equal(pins()[0]!.textContent, "1");
  assert.equal(pins()[0]!.style.left, "129px", "top-right corner minus half the pin");
  assert.equal(pins()[0]!.style.top, "89px");

  setRect(b, { left: 100, top: 300, width: 40, height: 20 });
  s.win.dispatchEvent(new s.Event("scroll"));
  assert.equal(pins().length, 2);
});

test("a thread with a missing element yields no pin", () => {
  const s = setup(`<p id="a">a</p>`);
  const a = s.document.getElementById("a")!;
  const t = thread(1, a);
  t.element = { ...t.element, selector: "#gone", text: "no such text", tag: "section" };
  s.overlay.store.set({ threads: [t] });
  assert.equal(s.root.querySelectorAll(".tb-pin").length, 0);
});

test("onPick fires for a crumb click with that ancestor", () => {
  const picks: { ref: ElementRef; el: Element }[] = [];
  const s = setup(
    `<div id="wrap"><div class="plan"><button id="trial">Go</button></div></div>`,
    (ref, el) => picks.push({ ref, el }),
  );
  s.overlay.store.set({ mode: "comment" });
  s.fire(s.document.getElementById("trial")!, "mousemove");
  const crumbs = [...s.root.querySelectorAll(".tb-crumbs button")] as HTMLElement[];
  assert.deepEqual(crumbs.map((c) => c.textContent), ["div#wrap", "div.plan", "button#trial"]);
  // ArrowUp works even while focus sits on an overlay button (the host is the event target).
  s.fire(s.document.getElementById(brand.hostId)!, "keydown", { key: "ArrowUp" });
  const lit = () => [...s.root.querySelectorAll(".tb-crumbs button.on")].map((c) => c.textContent);
  assert.deepEqual(lit(), ["div.plan"]);
  const crumbs2 = [...s.root.querySelectorAll(".tb-crumbs button")] as HTMLElement[];
  s.fire(crumbs2[1]!, "click");
  assert.equal(picks.length, 1);
  assert.equal(picks[0]!.el, s.document.querySelector(".plan"));
  assert.equal(picks[0]!.ref.tag, "div");
});

test("clicks inside the overlay host are ignored by hover", () => {
  const picks: Element[] = [];
  const s = setup(`<button id="trial">Go</button>`, (_ref, el) => picks.push(el));
  s.overlay.store.set({ mode: "comment" });
  const host = s.document.getElementById(brand.hostId)!;
  assert.ok(host, "host element exists");

  const inside = s.fire(host, "click");
  s.fire(host, "mousemove");
  assert.equal(picks.length, 0);
  assert.equal(inside.defaultPrevented, false);
  assert.equal(s.root.querySelector(".tb-outline"), null);

  // Positive control: the same click on the page is picked and swallowed.
  const page = s.fire(s.document.getElementById("trial")!, "click");
  assert.equal(picks.length, 1);
  assert.equal(page.defaultPrevented, true);
});
