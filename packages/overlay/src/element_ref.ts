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
