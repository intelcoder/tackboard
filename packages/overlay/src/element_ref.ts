import type { ElementRef, ThreadDto } from "@app/shared";
import { LIMITS } from "@app/shared";
import { readSourceInfo } from "./source_map.ts";
import type { Store } from "./store.ts";

const cleanText = (s: string | null | undefined): string => (s ?? "").replace(/\s+/g, " ").trim();

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

function childPosition(el: Element): number {
  let n = 1;
  for (let s = el.previousElementSibling; s; s = s.previousElementSibling) n++;
  return n;
}

function selectorFor(el: Element): string {
  if (hasUniqueId(el)) return `#${cssEscape(el.id)}`;
  const doc = el.ownerDocument;
  if (el === doc.body || el === doc.documentElement) return el.tagName.toLowerCase();
  const segments: string[] = [];
  let cur: Element | null = el;
  let anchor = "body";
  while (cur && cur !== doc.body && cur !== doc.documentElement) {
    if (cur !== el && hasUniqueId(cur)) {
      anchor = `#${cssEscape(cur.id)}`;
      break;
    }
    segments.unshift(`${cur.tagName.toLowerCase()}:nth-child(${childPosition(cur)})`);
    cur = cur.parentElement;
  }
  return `${anchor} > ${segments.join(" > ")}`;
}

export function buildElementRef(el: Element): ElementRef {
  const r = el.getBoundingClientRect();
  return {
    selector: selectorFor(el),
    tag: el.tagName.toLowerCase(),
    text: cleanText(el.textContent).slice(0, LIMITS.elementText),
    html: el.outerHTML.slice(0, LIMITS.html),
    rect: { x: r.x ?? r.left, y: r.y ?? r.top, w: r.width, h: r.height },
    ...readSourceInfo(el),
  };
}

/** The elements whose normalised text is one of `wanted`, by tag and text, in one pass over the page. The first in document order wins. */
function elementsByText(doc: Document, wanted: Set<string>): Map<string, Element> {
  const limit = LIMITS.elementText + 2;
  const all = doc.querySelectorAll("*");
  const done: (string | null)[] = [];
  const index = new Map<string, Element>();
  // Children come after their parent in `all`, so going backwards has each child's text ready on `done`, first child on top.
  for (let i = all.length - 1; i >= 0; i--) {
    const el = all[i]!;
    let text: string | null = "";
    for (let node = el.firstChild; node; node = node.nextSibling) {
      const part = node.nodeType === 3 ? (node as Text).data : node.nodeType === 1 ? (done.pop() ?? null) : "";
      text = text === null || part === null ? null : text + part;
    }
    if (text !== null) {
      text = text.replace(/\s+/g, " ");
      if (text.length > limit) text = null;
    }
    done.push(text);
    const trimmed = text?.trim();
    if (trimmed && wanted.has(trimmed)) index.set(`${el.tagName.toLowerCase()}\0${trimmed}`, el);
  }
  return index;
}

/** Selector first (an agent thread has no tag, any element matches), then the same tag with exactly the same text, else null (the thread is "detached"). */
function findElement(ref: ElementRef, doc: Document, elementsByText: () => Map<string, Element>): Element | null {
  try {
    const hit = doc.querySelector(ref.selector);
    if (hit && (!ref.tag || hit.tagName.toLowerCase() === ref.tag)) return hit;
  } catch {
    // an invalid stored selector falls through to the text match
  }
  if (!ref.text) return null;
  return elementsByText().get(`${ref.tag}\0${ref.text}`) ?? null;
}

const pageOf = (url: string): string => {
  try {
    const u = new URL(url);
    return u.origin + u.pathname;
  } catch {
    return url;
  }
};

/**
 * Finds the element of a thread on this page and keeps it. Threads from other pages are never looked up.
 * A thread with no element is searched again only when the thread list or the page url changes (once per poll).
 */
export function createFinder(doc: Document, win: Window, store: Store): { find(t: Pick<ThreadDto, "id" | "url" | "element">): Element | null } {
  const kept = new Map<string, Element | null>();
  let list: ThreadDto[] = [];
  let page = "";
  let cachedElements: Map<string, Element> | null = null;
  return {
    find(t) {
      const here = win.location.href;
      if (t.url && pageOf(t.url) !== pageOf(here)) return null;
      const threads = store.get().threads;
      if (threads !== list || here !== page) {
        for (const [id, el] of kept) if (!el || here !== page) kept.delete(id);
        list = threads;
        page = here;
        cachedElements = null;
      }
      let el = kept.get(t.id);
      if (el === undefined) {
        el = findElement(t.element, doc, () => (cachedElements ??= elementsByText(doc, new Set(threads.map((x) => x.element.text)))));
        kept.set(t.id, el);
      } else if (el && !el.isConnected) {
        el = null;
        kept.set(t.id, null);
      }
      return el;
    },
  };
}

/** Innermost first, ending below `root`. `root` and `<html>` are never included. */
export function parentsOf(el: Element, root: Element): Element[] {
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

/** The smallest element that holds the whole box, found from the topmost element at its centre; elements inside `skip` (the overlay) are ignored. */
export function elementForBox(doc: Document, box: { x: number; y: number; w: number; h: number }, skip: Element): Element | null {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const hit = (doc.elementsFromPoint?.(cx, cy) ?? [doc.elementFromPoint?.(cx, cy)]).find((e): e is Element => !!e && e !== skip && !skip.contains(e));
  let el: Element | null = hit ?? null;
  const html = doc.documentElement;
  while (el && el !== doc.body && el !== html) {
    const r = el.getBoundingClientRect();
    if (r.left <= box.x + 1 && r.top <= box.y + 1 && r.right >= box.x + box.w - 1 && r.bottom >= box.y + box.h - 1) return el;
    el = el.parentElement;
  }
  return null;
}

/** The element for a selection: the closest element above its common ancestor. */
export function elementOfRange(range: Range): Element | null {
  const n = range.commonAncestorContainer;
  return n.nodeType === 1 ? (n as Element) : n.parentElement;
}

const overlapShare = (el: Element, box: { x: number; y: number; w: number; h: number }): number => {
  const r = el.getBoundingClientRect();
  const w = Math.min(r.right, box.x + box.w) - Math.max(r.left, box.x);
  const h = Math.min(r.bottom, box.y + box.h) - Math.max(r.top, box.y);
  return w > 0 && h > 0 ? (w * h) / (r.width * r.height) : 0;
};

/**
 * The direct children of `container` that the box covers (half or more of each), when at least two of them
 * look alike (same tag and first class): the cards, rows or list items the user meant. Otherwise none, because
 * a box over mixed parts is already described by the container.
 */
export function siblingsInBox(container: Element, box: { x: number; y: number; w: number; h: number }): Element[] {
  const groups = new Map<string, Element[]>();
  let best: Element[] = [];
  for (const child of Array.from(container.children)) {
    if (overlapShare(child, box) < 0.5) continue;
    const key = `${child.tagName}.${(child.getAttribute("class") ?? "").split(/\s+/)[0]}`;
    const group = groups.get(key) ?? [];
    group.push(child);
    groups.set(key, group);
    if (group.length > best.length) best = group;
  }
  return best.length >= 2 ? best : [];
}
