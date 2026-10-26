import type { H } from "./dom.ts";

type Rect = { x: number; y: number; w: number; h: number };
export type Sides = { top: number; right: number; bottom: number; left: number };
type Band = { kind: "margin" | "padding" | "gap"; rect: Rect; text: string };
type BoxInput = {
  box: Rect;
  border: Sides;
  margin: Sides;
  padding: Sides;
  rowGap: number;
  columnGap: number;
  children: Rect[];
};

// The four strips between an outer rectangle and the one inside it, each with its pixel value.
function strips(kind: Band["kind"], outer: Rect, inner: Rect, v: Sides): Band[] {
  const innerRight = inner.x + inner.w;
  const innerBottom = inner.y + inner.h;
  const all: [number, Rect][] = [
    [v.top, { x: outer.x, y: outer.y, w: outer.w, h: inner.y - outer.y }],
    [v.right, { x: innerRight, y: inner.y, w: outer.x + outer.w - innerRight, h: inner.h }],
    [v.bottom, { x: outer.x, y: innerBottom, w: outer.w, h: outer.y + outer.h - innerBottom }],
    [v.left, { x: outer.x, y: inner.y, w: inner.x - outer.x, h: inner.h }],
  ];
  return all.filter(([n]) => Math.round(n) > 0).map(([n, rect]) => ({ kind, rect, text: String(Math.round(n)) }));
}

// Gap bands between children that sit in one line along the x axis or the y axis.
function gapBands(children: Rect[], rowGap: number, columnGap: number): Band[] {
  for (const horizontal of [true, false]) {
    const size = horizontal ? columnGap : rowGap;
    const [a, aSize, b, bSize]: ["x" | "y", "w" | "h", "x" | "y", "w" | "h"] = horizontal ? ["x", "w", "y", "h"] : ["y", "h", "x", "w"];
    const sorted = [...children].sort((p, q) => p[a] - q[a]);
    const inLine = sorted.every((next, i) => {
      const prev = sorted[i - 1];
      return !prev || (next[a] >= prev[a] + prev[aSize] - 0.5 && next[b] < prev[b] + prev[bSize] && prev[b] < next[b] + next[bSize]);
    });
    if (!inLine) continue;
    const bands: Band[] = [];
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1]!;
      const next = sorted[i]!;
      const start = prev[a] + prev[aSize];
      const length = Math.min(size, next[a] - start);
      if (length <= 0.5) continue;
      const cross = Math.min(prev[b], next[b]);
      const crossSize = Math.max(prev[b] + prev[bSize], next[b] + next[bSize]) - cross;
      bands.push({ kind: "gap", rect: horizontal ? { x: start, y: cross, w: length, h: crossSize } : { x: cross, y: start, w: crossSize, h: length }, text: "" });
    }
    return bands;
  }
  return [];
}

/** The shaded bands for one element and the gap text for its label ("" when it has no gap). */
export function boxBands(i: BoxInput): { bands: Band[]; gap: string } {
  const { box, border, margin, padding } = i;
  const bands = strips(
    "margin",
    { x: box.x - margin.left, y: box.y - margin.top, w: box.w + margin.left + margin.right, h: box.h + margin.top + margin.bottom },
    box,
    margin,
  );
  const paddingBox = { x: box.x + border.left, y: box.y + border.top, w: box.w - border.left - border.right, h: box.h - border.top - border.bottom };
  bands.push(
    ...strips(
      "padding",
      paddingBox,
      { x: paddingBox.x + padding.left, y: paddingBox.y + padding.top, w: paddingBox.w - padding.left - padding.right, h: paddingBox.h - padding.top - padding.bottom },
      padding,
    ),
  );
  const row = Math.round(i.rowGap);
  const column = Math.round(i.columnGap);
  if (row <= 0 && column <= 0) return { bands, gap: "" };
  bands.push(...gapBands(i.children, i.rowGap, i.columnGap));
  return { bands, gap: row === column ? `gap ${row}` : `gap ${row} ${column}` };
}

const px = (value: string): number => parseFloat(value) || 0;
const sidesOf = (s: CSSStyleDeclaration, name: (side: string) => string): Sides => ({
  top: px(s.getPropertyValue(name("top"))),
  right: px(s.getPropertyValue(name("right"))),
  bottom: px(s.getPropertyValue(name("bottom"))),
  left: px(s.getPropertyValue(name("left"))),
});

/** Reads the element once and draws its bands into one node. Returns the node and the gap text. */
export function drawBox(el: Element, win: Window, h: H): { node: HTMLElement; gap: string } {
  const s = win.getComputedStyle(el);
  const r = el.getBoundingClientRect();
  const node = h("div", { class: "tb-box" });
  if (s.display === "contents" || (r.width === 0 && r.height === 0)) return { node, gap: "" };
  const rowGap = px(s.rowGap);
  const columnGap = px(s.columnGap);
  const container = /flex|grid/.test(s.display) && (rowGap > 0 || columnGap > 0);
  const children = container ? Array.from(el.children, (c) => c.getBoundingClientRect()).filter((c) => c.width > 0 || c.height > 0).map((c) => ({ x: c.left, y: c.top, w: c.width, h: c.height })) : [];
  const { bands, gap } = boxBands({
    box: { x: r.left, y: r.top, w: r.width, h: r.height },
    border: sidesOf(s, (side) => `border-${side}-width`),
    margin: sidesOf(s, (side) => `margin-${side}`),
    padding: sidesOf(s, (side) => `padding-${side}`),
    rowGap,
    columnGap,
    children,
  });
  for (const b of bands) {
    const band = h("div", { class: `tb-band ${b.kind}` }, b.text);
    Object.assign(band.style, { left: `${b.rect.x}px`, top: `${b.rect.y}px`, width: `${b.rect.w}px`, height: `${b.rect.h}px` });
    node.append(band);
  }
  return { node, gap };
}
