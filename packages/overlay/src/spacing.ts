import type { H } from "./dom.ts";

type Rect = { x: number; y: number; w: number; h: number };
export type Edges = { top: number; right: number; bottom: number; left: number };
type Strip = { kind: "margin" | "padding" | "gap"; rect: Rect; text: string };
type SpacingInput = {
  elementRect: Rect;
  border: Edges;
  margin: Edges;
  padding: Edges;
  rowGap: number;
  columnGap: number;
  children: Rect[];
};

// The four strips between an outer rectangle and the one inside it, each with its pixel value.
function edgeStrips(kind: Strip["kind"], outer: Rect, inner: Rect, v: Edges): Strip[] {
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

// Gap strips between children that sit in one line along the x axis or the y axis.
function gapStrips(children: Rect[], rowGap: number, columnGap: number): Strip[] {
  for (const horizontal of [true, false]) {
    const size = horizontal ? columnGap : rowGap;
    const [a, aSize, b, bSize]: ["x" | "y", "w" | "h", "x" | "y", "w" | "h"] = horizontal ? ["x", "w", "y", "h"] : ["y", "h", "x", "w"];
    const sorted = [...children].sort((p, q) => p[a] - q[a]);
    const inLine = sorted.every((next, i) => {
      const prev = sorted[i - 1];
      return !prev || (next[a] >= prev[a] + prev[aSize] - 0.5 && next[b] < prev[b] + prev[bSize] && prev[b] < next[b] + next[bSize]);
    });
    if (!inLine) continue;
    const strips: Strip[] = [];
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1]!;
      const next = sorted[i]!;
      const start = prev[a] + prev[aSize];
      const length = Math.min(size, next[a] - start);
      if (length <= 0.5) continue;
      const cross = Math.min(prev[b], next[b]);
      const crossSize = Math.max(prev[b] + prev[bSize], next[b] + next[bSize]) - cross;
      strips.push({ kind: "gap", rect: horizontal ? { x: start, y: cross, w: length, h: crossSize } : { x: cross, y: start, w: crossSize, h: length }, text: "" });
    }
    return strips;
  }
  return [];
}

/** The shaded strips for one element and the gap text for its label ("" when it has no gap). */
export function spacingBands(i: SpacingInput): { strips: Strip[]; gap: string } {
  const { elementRect, border, margin, padding } = i;
  const strips = edgeStrips(
    "margin",
    { x: elementRect.x - margin.left, y: elementRect.y - margin.top, w: elementRect.w + margin.left + margin.right, h: elementRect.h + margin.top + margin.bottom },
    elementRect,
    margin,
  );
  const paddingBox = { x: elementRect.x + border.left, y: elementRect.y + border.top, w: elementRect.w - border.left - border.right, h: elementRect.h - border.top - border.bottom };
  strips.push(
    ...edgeStrips(
      "padding",
      paddingBox,
      { x: paddingBox.x + padding.left, y: paddingBox.y + padding.top, w: paddingBox.w - padding.left - padding.right, h: paddingBox.h - padding.top - padding.bottom },
      padding,
    ),
  );
  const row = Math.round(i.rowGap);
  const column = Math.round(i.columnGap);
  if (row <= 0 && column <= 0) return { strips, gap: "" };
  strips.push(...gapStrips(i.children, i.rowGap, i.columnGap));
  return { strips, gap: row === column ? `gap ${row}` : `gap ${row} ${column}` };
}

const px = (value: string): number => parseFloat(value) || 0;
const edgesOf = (s: CSSStyleDeclaration, name: (side: string) => string): Edges => ({
  top: px(s.getPropertyValue(name("top"))),
  right: px(s.getPropertyValue(name("right"))),
  bottom: px(s.getPropertyValue(name("bottom"))),
  left: px(s.getPropertyValue(name("left"))),
});

/** Reads the element once and draws its strips into one node. Returns the node and the gap text. */
export function drawSpacingStrips(el: Element, win: Window, h: H): { node: HTMLElement; gap: string } {
  const s = win.getComputedStyle(el);
  const r = el.getBoundingClientRect();
  const node = h("div", { class: "tb-spacing" });
  if (s.display === "contents" || (r.width === 0 && r.height === 0)) return { node, gap: "" };
  const rowGap = px(s.rowGap);
  const columnGap = px(s.columnGap);
  const container = /flex|grid/.test(s.display) && (rowGap > 0 || columnGap > 0);
  const children = container ? Array.from(el.children, (c) => c.getBoundingClientRect()).filter((c) => c.width > 0 || c.height > 0).map((c) => ({ x: c.left, y: c.top, w: c.width, h: c.height })) : [];
  const { strips, gap } = spacingBands({
    elementRect: { x: r.left, y: r.top, w: r.width, h: r.height },
    border: edgesOf(s, (side) => `border-${side}-width`),
    margin: edgesOf(s, (side) => `margin-${side}`),
    padding: edgesOf(s, (side) => `padding-${side}`),
    rowGap,
    columnGap,
    children,
  });
  for (const b of strips) {
    const strip = h("div", { class: `tb-strip ${b.kind}` }, b.text);
    Object.assign(strip.style, { left: `${b.rect.x}px`, top: `${b.rect.y}px`, width: `${b.rect.w}px`, height: `${b.rect.h}px` });
    node.append(strip);
  }
  return { node, gap };
}
