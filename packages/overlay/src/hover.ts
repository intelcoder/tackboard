import { drawSpacingStrips } from "./spacing.ts";
import { parentsOf, buildElementRef, labelFor } from "./element_ref.ts";
import type { H } from "./dom.ts";
import type { Store } from "./store.ts";
import type { ElementRef } from "@app/shared";

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
    outline = crumbs = box = null;
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

  const pick = (el: Element) => {
    clearUi();
    o.onPick(buildElementRef(el), el);
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

  const onMove = (e: Event) => {
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
    const t = targetOf(e);
    const el = chain[index] ?? (t ? parentsOf(t, doc.body)[0] : undefined);
    if (el) pick(el);
  };

  const onDown = (e: Event) => {
    if (!inside(e)) ignoreError(e);
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
