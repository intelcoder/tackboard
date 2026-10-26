import { test } from "node:test";
import assert from "node:assert/strict";
import { spacingBands } from "../src/spacing.ts";
import type { Edges } from "../src/spacing.ts";

const none: Edges = { top: 0, right: 0, bottom: 0, left: 0 };
const elementRect = { x: 100, y: 50, w: 200, h: 100 };
const base = { elementRect, border: none, margin: none, padding: none, rowGap: 0, columnGap: 0, children: [] };

test("margin strips sit outside the border box and padding strips inside it, with a number for each non-zero side", () => {
  const { strips, gap } = spacingBands({ ...base, margin: { top: 10, right: 20, bottom: 0, left: 5 }, padding: { top: 8, right: 8, bottom: 8, left: 8 } });
  const margin = strips.filter((b) => b.kind === "margin");
  assert.deepEqual(margin.map((b) => [b.text, b.rect]), [
    ["10", { x: 95, y: 40, w: 225, h: 10 }],
    ["20", { x: 300, y: 50, w: 20, h: 100 }],
    ["5", { x: 95, y: 50, w: 5, h: 100 }],
  ]);
  const padding = strips.filter((b) => b.kind === "padding");
  assert.deepEqual(padding.map((b) => b.rect), [
    { x: 100, y: 50, w: 200, h: 8 },
    { x: 292, y: 58, w: 8, h: 84 },
    { x: 100, y: 142, w: 200, h: 8 },
    { x: 100, y: 58, w: 8, h: 84 },
  ]);
  assert.equal(gap, "");
});

test("a box with no margin, padding or gap has no strips, and fractions are rounded", () => {
  assert.deepEqual(spacingBands(base), { strips: [], gap: "" });
  const { strips } = spacingBands({ ...base, margin: { ...none, top: 10.4, left: 0.3 } });
  assert.deepEqual(strips.map((b) => b.text), ["10"]);
});

test("the border pushes the padding strips inward", () => {
  const { strips } = spacingBands({ ...base, border: { top: 2, right: 2, bottom: 2, left: 2 }, padding: { ...none, left: 6 } });
  assert.deepEqual(strips.map((b) => b.rect), [{ x: 102, y: 52, w: 6, h: 96 }]);
});

const row = [
  { x: 0, y: 0, w: 50, h: 20 },
  { x: 66, y: 0, w: 50, h: 30 },
  { x: 132, y: 0, w: 50, h: 20 },
];

test("a single row gets column-gap strips between its children and the number in the label", () => {
  const { strips, gap } = spacingBands({ ...base, columnGap: 16, rowGap: 16, children: row });
  assert.equal(gap, "gap 16");
  assert.deepEqual(strips.map((b) => [b.kind, b.rect]), [
    ["gap", { x: 50, y: 0, w: 16, h: 30 }],
    ["gap", { x: 116, y: 0, w: 16, h: 30 }],
  ]);
});

test("a single column gets row-gap strips, and two different gaps show both numbers", () => {
  const column = row.map((r, i) => ({ x: 0, y: i * 28, w: 50, h: 20 }));
  const { strips, gap } = spacingBands({ ...base, rowGap: 8, columnGap: 0, children: column });
  assert.equal(gap, "gap 8 0");
  assert.deepEqual(strips.map((b) => b.rect), [
    { x: 0, y: 20, w: 50, h: 8 },
    { x: 0, y: 48, w: 50, h: 8 },
  ]);
});

test("a wrapped layout shows the number only, and no gap means nothing", () => {
  const wrapped = [...row.slice(0, 2), { x: 0, y: 46, w: 50, h: 20 }];
  assert.deepEqual(spacingBands({ ...base, rowGap: 16, columnGap: 16, children: wrapped }), { strips: [], gap: "gap 16" });
  assert.deepEqual(spacingBands({ ...base, children: row }), { strips: [], gap: "" });
});
