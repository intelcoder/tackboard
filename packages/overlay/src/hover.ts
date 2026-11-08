import { drawSpacingStrips } from "./spacing.ts";
import { parentsOf, buildElementRef, labelFor, elementForBox, elementOfRange, siblingsInBox } from "./element_ref.ts";
import type { H } from "./dom.ts";
import type { Store } from "./store.ts";
import type { ElementRef } from "@app/shared";
import { LIMITS, redactText } from "@app/shared";

/** How far the mouse must move with the button down before a press becomes a dragged box. */
const DRAG_PX = 6;

export type HoverOptions = {
  document: Document;
  window: Window;
  host: Element;
  layer: Element;
  h: H;
  store: Store;
  onPick: (ref: ElementRef, el: Element) => void;
};

/**
 * Comment mode: outline the innermost element under the cursor, list its ancestors in a
 * path bar, let arrows or crumbs move the outline outward, and turn a click into onPick.
 * While Control is held it also shades the outlined element's margin, padding and gaps.
 * Dragging draws a box and comments on the smallest element holding it; Shift+drag selects text
 * and comments on those words.
 * Active only while mode is "comment" and no Composer is open; otherwise it leaves no nodes.
 */
export function createHover(o: HoverOptions): { destroy(): void } {
  const { document: doc, window: win, host, layer, h, store } = o;
  let chain: Element[] = [];
  let index = 0;
  let last: Element | null = null;
  let outline: HTMLElement | null = null;
  let crumbs: HTMLElement | null = null;
  let box: HTMLElement | null = null;
  let control = false;
  let installed = false;
  let down: { x: number; y: number; shift: boolean } | null = null;
  let dragging = false;
  let areaEl: HTMLElement | null = null;
  // a drag or a selection ends in a click event; it must not also pick the element under the cursor
  let skipClick = false;

  const pathOf = (e: Event): EventTarget[] => (typeof e.composedPath === "function" ? e.composedPath() : []);
  const inside = (e: Event): boolean => {
    const t = e.target as Node | null;
    return pathOf(e).includes(host) || t === host || (!!t && host.contains(t));
  };
  const targetOf = (e: Event): Element | null => {
    const first = (pathOf(e)[0] ?? e.target) as Node | null;
    return first && first.nodeType === 1 ? (first as Element) : null;
  };

  const clearUi = () => {
    outline?.remove();
    crumbs?.remove();
    box?.remove();
    areaEl?.remove();
    outline = crumbs = box = areaEl = null;
    chain = [];
    last = null;
    index = 0;
  };

  const drawOutline = (el: Element) => {
    const r = el.getBoundingClientRect();
    if (!outline) {
      outline = h("div", { class: "tb-outline" }, h("span", { class: "tb-outline-tag" }));
      layer.append(outline);
    }
    Object.assign(outline.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
    const tag = outline.firstElementChild as HTMLElement;
    tag.textContent = labelFor(el);
    tag.classList.toggle("below", r.top < 24);
  };

  // Reads the outlined element once and shades it while Control is held; the gap text joins the outline label.
  const drawSpacing = () => {
    if (!control && !box) return;
    box?.remove();
    box = null;
    const el = chain[index];
    const tag = outline?.firstElementChild;
    if (!el || !tag) return;
    if (!control) {
      tag.textContent = labelFor(el);
      return;
    }
    const drawn = drawSpacingStrips(el, win, h);
    box = drawn.node;
    layer.append(box);
    if (drawn.gap) tag.textContent = `${labelFor(el)}  ${drawn.gap}`;
  };

  const pick = (el: Element, extra: Partial<ElementRef> = {}) => {
    clearUi();
    o.onPick({ ...buildElementRef(el), ...extra }, el);
  };

  const drawCrumbs = () => {
    crumbs?.remove();
    crumbs = h("div", { class: "tb-crumbs", role: "group", "aria-label": "Element path" });
    for (let i = chain.length - 1; i >= 0; i--) {
      const el = chain[i]!;
      crumbs.append(h("button", {
        type: "button",
        class: i === index ? "on" : null,
        onmouseenter: () => drawOutline(el),
        onmouseleave: () => chain[index] && drawOutline(chain[index]!),
        onclick: (ev: Event) => {
          ev.preventDefault();
          index = i;
          pick(el);
        },
      }, labelFor(el)));
      if (i > 0) crumbs.append(h("span", { class: "sep", "aria-hidden": "true" }, "›"));
    }
    crumbs.append(h("span", { class: "hint" }, "↑ ↓ move"));
    layer.append(crumbs);
  };

  const redraw = () => {
    if (!chain[index]) return;
    drawOutline(chain[index]!);
    drawSpacing();
    drawCrumbs();
  };

  const boxOf = (from: { x: number; y: number }, e: MouseEvent) => ({
    x: Math.min(from.x, e.clientX), y: Math.min(from.y, e.clientY),
    w: Math.abs(e.clientX - from.x), h: Math.abs(e.clientY - from.y),
  });

  const onMove = (e: Event) => {
    if (down && !down.shift && ((e as MouseEvent).buttons ?? 1) & 1) {
      const m = e as MouseEvent;
      if (!dragging && Math.hypot(m.clientX - down.x, m.clientY - down.y) < DRAG_PX) return;
      if (!dragging) {
        dragging = true;
        clearUi();
      }
      const b = boxOf(down, m);
      if (!areaEl) {
        areaEl = h("div", { class: "tb-area" });
        layer.append(areaEl);
      }
      Object.assign(areaEl.style, { left: `${b.x}px`, top: `${b.y}px`, width: `${b.w}px`, height: `${b.h}px` });
      return;
    }
    if (inside(e)) return;
    const t = targetOf(e);
    if (!t) return;
    if (t === last) return;
    last = t;
    chain = parentsOf(t, doc.body);
    index = 0;
    if (!chain.length) return clearUi();
    redraw();
  };

  const ignoreError = (e: Event) => {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
  };

  const onClick = (e: Event) => {
    if (inside(e)) return;
    ignoreError(e);
    if (skipClick) {
      skipClick = false;
      return;
    }
    const t = targetOf(e);
    const el = chain[index] ?? (t ? parentsOf(t, doc.body)[0] : undefined);
    if (el) pick(el);
  };

  const onDown = (e: Event) => {
    if (inside(e)) return;
    const m = e as MouseEvent;
    // pointerdown and mousedown both arrive; the second one only repeats the first
    if (m.type === "mousedown") skipClick = false;
    if (m.type === "mousedown" && (m.button ?? 0) === 0) down = { x: m.clientX, y: m.clientY, shift: !!m.shiftKey };
    // Shift leaves the browser's own text selection alone; any other press must not select or focus anything
    if (!(m.shiftKey && m.type === "mousedown")) ignoreError(e);
  };

  const onUp = (e: Event) => {
    const start = down;
    down = null;
    if (!start || inside(e)) return void (dragging = false, clearUi());
    const m = e as MouseEvent;
    if (dragging) {
      dragging = false;
      skipClick = true;
      const b = boxOf(start, m);
      areaEl?.remove();
      areaEl = null;
      const el = elementForBox(doc, b, host);
      if (el) {
        // the like-looking children the box covers join as "also" elements, so the agent knows which of many cards it meant
        const also = siblingsInBox(el, b).slice(0, LIMITS.also).map((c) => ({ ...buildElementRef(c), detail: undefined }));
        pick(el, { rect: b, area: true, ...(also.length ? { also } : {}) });
      }
      return;
    }
    if (!start.shift) return;
    const sel = win.getSelection?.();
    const text = sel?.toString().replace(/\s+/g, " ").trim();
    if (!sel || !sel.rangeCount || !text) return;
    const range = sel.getRangeAt(0);
    const el = elementOfRange(range);
    if (!el || host.contains(el)) return;
    skipClick = true;
    const r = range.getBoundingClientRect();
    sel.removeAllRanges();
    pick(el, { rect: { x: r.x ?? r.left, y: r.y ?? r.top, w: r.width, h: r.height }, selection: redactText(text).slice(0, LIMITS.selection) });
  };

  const onKey = (e: Event) => {
    const key = (e as KeyboardEvent).key;
    if (key === "Control") {
      if (!(e as KeyboardEvent).repeat) {
        control = true;
        drawSpacing();
      }
      return;
    }
    if ((key !== "ArrowUp" && key !== "ArrowDown") || !chain.length) return;
    // Focus may sit on an overlay button (clicking a tool keeps it there), so only typing fields are left alone.
    const t = targetOf(e);
    if (t && (/^(input|textarea|select)$/i.test(t.tagName) || (t as HTMLElement).isContentEditable)) return;
    e.preventDefault();
    index = Math.max(0, Math.min(chain.length - 1, index + (key === "ArrowUp" ? 1 : -1)));
    redraw();
  };

  const stopControl = () => {
    control = false;
    drawSpacing();
  };
  const onKeyUp = (e: Event) => {
    if ((e as KeyboardEvent).key === "Control") stopControl();
  };
  const onScroll = () => {
    if (chain[index]) drawOutline(chain[index]!);
    stopControl();
  };

  const listeners: [EventTarget, string, EventListener][] = [
    [doc, "mousemove", onMove],
    [doc, "click", onClick],
    [doc, "mousedown", onDown],
    [doc, "pointerdown", onDown],
    [doc, "mouseup", onUp],
    [doc, "keydown", onKey],
    [doc, "keyup", onKeyUp],
    [win, "blur", stopControl],
    [win, "scroll", onScroll],
    [win, "resize", onScroll],
  ];

  const install = () => {
    if (installed) return;
    installed = true;
    for (const [t, type, fn] of listeners) t.addEventListener(type, fn, true);
  };
  const uninstall = () => {
    if (!installed) return;
    installed = false;
    for (const [t, type, fn] of listeners) t.removeEventListener(type, fn, true);
    control = false;
    down = null;
    dragging = false;
    clearUi();
  };

  const sync = () => {
    const s = store.get();
    if (s.mode === "comment" && !s.composing) install();
    else uninstall();
  };
  const unsub = store.subscribe(sync);
  sync();
  return {
    destroy() {
      unsub();
      uninstall();
    },
  };
}
