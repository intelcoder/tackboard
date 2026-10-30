import { test } from "node:test";
import assert from "node:assert/strict";
import { bytesOfDataUrl, inPicture, visiblePart } from "../src/screenshot.ts";

const view = { w: 1000, h: 800 };

test("the visible part is the box clipped to the window", () => {
  assert.deepEqual(visiblePart({ x: 10, y: 20, w: 100, h: 50 }, view), { x: 10, y: 20, w: 100, h: 50 });
  assert.deepEqual(visiblePart({ x: -40, y: 750, w: 100, h: 100 }, view), { x: 0, y: 750, w: 60, h: 50 });
});

test("a box that is off screen or too small to see has no visible part", () => {
  assert.equal(visiblePart({ x: 0, y: 900, w: 100, h: 50 }, view), null);
  assert.equal(visiblePart({ x: 10, y: 10, w: 0, h: 50 }, view), null);
  assert.equal(visiblePart({ x: 998, y: 10, w: 100, h: 50 }, view), null, "under 4 px showing");
});

test("a sharper picture scales the box by the width ratio", () => {
  assert.deepEqual(inPicture({ x: 10, y: 20, w: 100, h: 50.4 }, view.w, 2000), { x: 20, y: 40, w: 200, h: 101 });
  assert.deepEqual(inPicture({ x: 10, y: 20, w: 100, h: 50 }, view.w, 1000), { x: 10, y: 20, w: 100, h: 50 });
});

test("bytes come out of a data URL", () => {
  assert.deepEqual([...bytesOfDataUrl("data:image/png;base64,aGk=")], [104, 105]);
  assert.throws(() => bytesOfDataUrl("not a data url"), /picture/);
});
