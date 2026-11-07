// A small live picture of the commented element, built from the page itself: nothing is captured, sent or stored.
import type { H } from "./dom.ts";

const MAX_NODES = 600;
const THUMB = { w: 120, h: 56 };
const DROP = "script,noscript,iframe,video,audio,object,embed";

/** Copy `id` and `class` onto an empty element of the same tag. */
function shell(into: Document, from: Element): Element {
  const e = into.createElement(from.localName);
  for (const a of ["id", "class"]) if (from.hasAttribute(a)) e.setAttribute(a, from.getAttribute(a)!);
  return e;
}

/**
 * Fill an empty document so it shows only `el`: the page's own styles, a copy of the element (scripts removed, its width
 * kept) inside empty copies of its ancestors so selectors like `.page .card` still match. Built with DOM calls only,
 * never from an HTML string. Returns the copy, or null when the element is too big to be a preview.
 * ponytail: ancestor paddings and inline styles are not reproduced; a lone element can look a little different.
 */
export function fillPreview(into: Document, from: Document, el: Element, width: number): Element | null {
  if (el.querySelectorAll("*").length > MAX_NODES) return null;
  const clone = into.importNode(el, true) as HTMLElement;
  clone.querySelectorAll(DROP).forEach((n) => n.remove());
  clone.setAttribute("data-tb-target", "");
  clone.setAttribute("style", `${clone.getAttribute("style") ?? ""};width:${width}px;box-sizing:border-box;margin:0`);
  if (from.baseURI) into.head.append(Object.assign(into.createElement("base"), { href: from.baseURI }));
  for (const n of from.querySelectorAll('link[rel~="stylesheet"], style')) {
    if (n.localName === "link") {
      const link = into.createElement("link");
      link.setAttribute("rel", "stylesheet");
      link.setAttribute("href", (n as HTMLLinkElement).href);
      into.head.append(link);
    } else {
      const style = into.createElement("style");
      style.textContent = n.textContent;
      into.head.append(style);
    }
  }
  const reset = into.createElement("style");
  reset.textContent = "html,body{margin:0;background:transparent}";
  into.head.append(reset);
  for (const a of ["class"]) {
    if (from.documentElement.hasAttribute(a)) into.documentElement.setAttribute(a, from.documentElement.getAttribute(a)!);
    if (from.body.hasAttribute(a)) into.body.setAttribute(a, from.body.getAttribute(a)!);
  }
  let top: Element = clone;
  for (let p = el.parentElement; p && p !== from.body && p !== from.documentElement; p = p.parentElement) {
    const outer = shell(into, p);
    outer.append(top);
    top = outer;
  }
  into.body.append(top);
  return clone;
}

/** The size the element's picture will have inside a box of at most `max`, or null when there is nothing to show. */
function fit(el: Element, max: { w: number; h: number }): { r: DOMRect; s: number; w: number; h: number } | null {
  const r = el.getBoundingClientRect();
  if (r.width < 1 || r.height < 1 || el.querySelectorAll("*").length > MAX_NODES) return null;
  const s = Math.min(max.w / r.width, max.h / r.height, 1);
  return { r, s, w: Math.ceil(r.width * s), h: Math.ceil(r.height * s) };
}

/** The element's picture inside a box of at most `max`, or null when there is nothing to show. */
export function elementPreview(h: H, win: Window, el: Element, max: { w: number; h: number }): HTMLElement | null {
  const size = fit(el, max);
  if (!size) return null;
  const { r, s } = size;
  // allow-same-origin without allow-scripts: the copy cannot run code, but we can fill and measure it.
  const frame = h("iframe", { class: "tb-frame", sandbox: "allow-same-origin", tabindex: "-1", "aria-hidden": "true" }) as HTMLIFrameElement;
  frame.style.width = `${Math.min(win.innerWidth, 1600)}px`;
  frame.style.height = `${Math.ceil(r.height) + 400}px`;
  frame.addEventListener("load", () => {
    const into = frame.contentDocument;
    if (!into || into.body.hasChildNodes()) return;
    const clone = fillPreview(into, win.document, el, r.width);
    if (!clone) return;
    const links = [...into.querySelectorAll("link")];
    const place = () => {
      const b = clone.getBoundingClientRect();
      frame.style.transform = `translate(${-b.x * s}px, ${-b.y * s}px) scale(${s})`;
    };
    // Place it once the page's stylesheets are in (or after a second), else it is measured unstyled.
    Promise.race([
      Promise.all(links.map((l) => new Promise((done) => { l.addEventListener("load", done); l.addEventListener("error", done); }))),
      new Promise((done) => win.setTimeout(done, 1000)),
    ]).then(place);
    place();
  });
  const box = h("div", { class: "tb-shot" }, frame);
  box.style.width = `${size.w}px`;
  box.style.height = `${size.h}px`;
  return box;
}

/** A small picture that grows beside the panel on hover. The pictures are built only once the row shows. */
export function previewThumb(h: H, win: Window, el: Element): HTMLElement | null {
  const size = fit(el, THUMB);
  if (!size) return null;
  const thumb = h("div", { class: "tb-thumb" });
  // The row has its final height from the start, so the panel does not jump when the picture loads.
  thumb.style.width = `${size.w}px`;
  thumb.style.height = `${size.h}px`;
  const build = () => {
    const small = elementPreview(h, win, el, THUMB);
    if (small) thumb.append(small);
  };
  const Observer = (win as unknown as { IntersectionObserver?: typeof IntersectionObserver }).IntersectionObserver;
  if (Observer) {
    const watch = new Observer((seen) => {
      if (!seen.some((e) => e.isIntersecting)) return;
      watch.disconnect();
      build();
    });
    watch.observe(thumb);
  } else build();
  let big: HTMLElement | null = null;
  thumb.addEventListener("mouseenter", () => {
    const panel = thumb.closest(".tb-panel")?.getBoundingClientRect();
    const picture = elementPreview(h, win, el, { w: Math.min(520, (panel?.left ?? win.innerWidth) - 24), h: 360 });
    if (!picture || !panel) return;
    big = h("div", { class: "tb-zoom" }, picture);
    big.style.right = `${win.innerWidth - panel.left + 8}px`;
    big.style.top = `${Math.max(8, Math.min(thumb.getBoundingClientRect().top, win.innerHeight - 380))}px`;
    thumb.append(big);
  });
  thumb.addEventListener("mouseleave", () => { big?.remove(); big = null; });
  return thumb;
}
