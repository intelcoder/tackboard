import { test } from "node:test";
import assert from "node:assert/strict";
import { bytesOfDataUrl, inPicture, visiblePart, whyNoShot } from "../src/screenshot.ts";

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

// whyNoShot only reads a box from each element and the window's size.
const el = (x: number, y: number, w: number, h: number) => ({ getBoundingClientRect: () => ({ x, y, width: w, height: h, right: x + w, bottom: y + h }) }) as unknown as Element;
const win = { innerWidth: 1000, innerHeight: 800 } as unknown as Window;
(win as { top: Window }).top = win;

test("several elements are pictured as the area they cover together", () => {
  assert.equal(whyNoShot(el(0, 900, 100, 50), win), "Scroll the element into view to attach a screenshot");
  // one on screen, one below: together they still overlap the screen
  assert.equal(whyNoShot([el(0, 900, 100, 50), el(10, 10, 100, 50)], win), null);
  assert.equal(whyNoShot([el(0, 900, 100, 50), el(0, 1000, 100, 50)], win), "Scroll the element into view to attach a screenshot");
});
