import type { ElementRef } from "@app/shared";
import { LIMITS } from "@app/shared";

const norm = (s: string | null | undefined): string => (s ?? "").replace(/\s+/g, " ").trim();

function cssEscape(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`).replace(/^(\d)/, "\\3$1 ");
}

function hasUniqueId(el: Element): boolean {
  if (!el.id) return false;
  try {
    return el.ownerDocument.querySelectorAll(`#${cssEscape(el.id)}`).length === 1;
  } catch {
    return false;
  }
}

function nthChild(el: Element): number {
  let n = 1;
  for (let s = el.previousElementSibling; s; s = s.previousElementSibling) n++;
  return n;
}

function selectorFor(el: Element): string {
  if (hasUniqueId(el)) return `#${cssEscape(el.id)}`;
  const doc = el.ownerDocument;
  if (el === doc.body || el === doc.documentElement) return el.tagName.toLowerCase();
  const segs: string[] = [];
  let cur: Element | null = el;
  let anchor = "body";
  while (cur && cur !== doc.body && cur !== doc.documentElement) {
    if (cur !== el && hasUniqueId(cur)) {
      anchor = `#${cssEscape(cur.id)}`;
      break;
    }
    segs.unshift(`${cur.tagName.toLowerCase()}:nth-child(${nthChild(cur)})`);
    cur = cur.parentElement;
  }
  return `${anchor} > ${segs.join(" > ")}`;
}

export function buildElementRef(el: Element): ElementRef {
  const r = el.getBoundingClientRect();
  return {
    selector: selectorFor(el),
    tag: el.tagName.toLowerCase(),
    text: norm(el.textContent).slice(0, LIMITS.elementText),
    html: el.outerHTML.slice(0, LIMITS.html),
    rect: { x: r.x ?? r.left, y: r.y ?? r.top, w: r.width, h: r.height },
    confidence: "text",
  };
}

/** Selector first, then the same tag with exactly the same text, else null (the thread is "detached"). */
export function findElement(ref: ElementRef, doc: Document): Element | null {
  try {
    const hit = doc.querySelector(ref.selector);
    if (hit && hit.tagName.toLowerCase() === ref.tag) return hit;
  } catch {
    // an invalid stored selector falls through to the text match
  }
  if (!ref.text) return null;
  for (const el of Array.from(doc.getElementsByTagName(ref.tag))) {
    if (norm(el.textContent) === ref.text) return el;
  }
  return null;
}

/** Innermost first, ending below `root`. `root` and `<html>` are never included. */
export function ancestorChain(el: Element, root: Element): Element[] {
  const out: Element[] = [];
  const html = el.ownerDocument.documentElement;
  for (let cur: Element | null = el; cur && cur !== root && cur !== html; cur = cur.parentElement) out.push(cur);
  return out;
}

export function labelFor(el: Element): string {
  const tag = el.tagName.toLowerCase();
  if (el.id) return `${tag}#${el.id}`;
  const first = (el.getAttribute("class") ?? "").split(/\s+/).find(Boolean);
  return first ? `${tag}.${first}` : tag;
}
