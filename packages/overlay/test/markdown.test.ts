import { test } from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { createH } from "../src/dom.ts";
import { markdown } from "../src/thread_view.ts";

test("agent markdown becomes nodes, never HTML", () => {
  const { document } = parseHTML("<div></div>");
  const h = createH(document as unknown as Document);
  const box = document.createElement("div");
  box.append(...(markdown(h, "Did **this** with `x`.\n\n- one\n- two\n\n```\ncode <b>\n```\n<img src=x>") as any[]));
  assert.equal(box.querySelectorAll("b").length, 1);
  assert.equal(box.querySelectorAll("li").length, 2);
  assert.equal(box.querySelector("pre")!.textContent, "code <b>");
  assert.equal(box.querySelectorAll("img").length, 0);
});

test("loose numbered list stays one list, and stars in args are not italic", () => {
  const { document } = parseHTML("<div></div>");
  const h = createH(document as unknown as Document);
  const box = document.createElement("div");
  box.append(...(markdown(h, "1. a\n\n2. b\n\n3. c\n\nuse *args, **kwargs and src/*.ts") as any[]));
  assert.equal(box.querySelectorAll("ol").length, 1);
  assert.equal(box.querySelectorAll("li").length, 3);
  assert.equal(box.querySelectorAll("i").length, 0);
});
