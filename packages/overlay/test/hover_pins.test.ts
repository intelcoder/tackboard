import { test } from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { brand } from "@app/shared";
import type { ElementRef, ThreadDto } from "@app/shared";
import { buildElementRef, siblingsInBox } from "../src/element_ref.ts";
import { mountOverlay } from "../src/index.ts";

type Rect = { left: number; top: number; width: number; height: number };

function setRect(el: Element, r: Rect) {
  (el as any).getBoundingClientRect = () => ({
    x: r.left, y: r.top, left: r.left, top: r.top, width: r.width, height: r.height,
    right: r.left + r.width, bottom: r.top + r.height,
  });
}

function setup(body: string, onPick?: (ref: ElementRef, el: Element) => void) {
  const parsed = parseHTML(`<html><body>${body}</body></html>`);
  const document = parsed.document as unknown as Document;
  const win = parsed.window as any;
  // linkedom has no location; the overlay compares thread urls with the page url
  Object.defineProperty(win, "location", { value: { href: "http://x/" }, configurable: true });
  const overlay = mountOverlay({
    document,
    window: win,
    config: { base: "http://127.0.0.1:1", token: "t" },
    viewport: () => ({ w: 800, h: 600 }),
    onPick,
  });
  const fire = (target: EventTarget, type: string, extra: Record<string, unknown> = {}) => {
    const ev = new parsed.Event(type, { bubbles: true, composed: true, cancelable: true }) as any;
    Object.assign(ev, extra);
    target.dispatchEvent(ev);
    return ev as Event;
  };
  return { document, win, overlay, root: overlay.root as ParentNode, fire, Event: parsed.Event as any };
}

function thread(n: number, el: Element, status: ThreadDto["status"] = "pending", url = "http://x/"): ThreadDto {
  return {
    id: `t${n}`, n, branch: "main", commit: "abc", url, viewport: { w: 800, h: 600 },
    element: buildElementRef(el), status, openedBy: "user", unread: false, discarded: false,
    claimStale: false, messages: [{ id: "m1", author: "user", text: "hi", at: 1, discarded: false }],
  };
}

test("hidden mode renders no pins, outline or crumbs", () => {
  const s = setup(`<div id="a"><button id="b">Go</button></div>`);
  const b = s.document.getElementById("b")!;
  setRect(b, { left: 10, top: 10, width: 50, height: 20 });
  s.overlay.store.set({ threads: [thread(1, b)], mode: "comment" });
  s.fire(b, "mousemove");
  assert.ok(s.root.querySelector(".tb-pin"), "pin in comment mode");
  assert.ok(s.root.querySelector(".tb-outline"), "outline in comment mode");
  assert.ok(s.root.querySelector(".tb-crumbs"), "crumbs in comment mode");

  s.overlay.store.set({ mode: "hidden" });
  s.fire(b, "mousemove");
  assert.equal(s.root.querySelector(".tb-pin"), null);
  assert.equal(s.root.querySelector(".tb-outline"), null);
  assert.equal(s.root.querySelector(".tb-crumbs"), null);
  assert.ok(s.root.querySelector(".tb-modes"), "the ModeSwitch stays");

  s.overlay.store.set({ mode: "view" });
  assert.ok(s.root.querySelector(".tb-pin"), "pins return in view mode");
  assert.equal(s.root.querySelector(".tb-outline"), null, "no outline outside comment mode");
});

test("a pin is not rendered while its element is off screen", () => {
  const s = setup(`<p id="a">a</p><p id="b">b</p>`);
  const a = s.document.getElementById("a")!;
  const b = s.document.getElementById("b")!;
  setRect(a, { left: 100, top: 100, width: 40, height: 20 });
  setRect(b, { left: 100, top: 5000, width: 40, height: 20 });
  s.overlay.store.set({ threads: [thread(1, a), thread(2, b)] });
  const pins = () => [...s.root.querySelectorAll(".tb-pin")] as HTMLElement[];
  assert.equal(pins().length, 1);
  assert.equal(pins()[0]!.textContent, "1");
  assert.equal(pins()[0]!.style.left, "129px", "top-right corner minus half the pin");
  assert.equal(pins()[0]!.style.top, "89px");

  setRect(b, { left: 100, top: 300, width: 40, height: 20 });
  s.win.dispatchEvent(new s.Event("scroll"));
  assert.equal(pins().length, 2);
});

test("a thread with a missing element yields no pin", () => {
  const s = setup(`<p id="a">a</p>`);
  const a = s.document.getElementById("a")!;
  const t = thread(1, a);
  t.element = { ...t.element, selector: "#gone", text: "no such text", tag: "section" };
  s.overlay.store.set({ threads: [t] });
  assert.equal(s.root.querySelectorAll(".tb-pin").length, 0);
});

test("onPick fires for a crumb click with that ancestor", () => {
  const picks: { ref: ElementRef; el: Element }[] = [];
  const s = setup(
    `<div id="wrap"><div class="plan"><button id="trial">Go</button></div></div>`,
    (ref, el) => picks.push({ ref, el }),
  );
  s.overlay.store.set({ mode: "comment" });
  s.fire(s.document.getElementById("trial")!, "mousemove");
  const crumbs = [...s.root.querySelectorAll(".tb-crumbs button")] as HTMLElement[];
  assert.deepEqual(crumbs.map((c) => c.textContent), ["div#wrap", "div.plan", "button#trial"]);
  // ArrowUp works even while focus sits on an overlay button (the host is the event target).
  s.fire(s.document.getElementById(brand.hostId)!, "keydown", { key: "ArrowUp" });
  const lit = () => [...s.root.querySelectorAll(".tb-crumbs button.on")].map((c) => c.textContent);
  assert.deepEqual(lit(), ["div.plan"]);
  const crumbs2 = [...s.root.querySelectorAll(".tb-crumbs button")] as HTMLElement[];
  s.fire(crumbs2[1]!, "click");
  assert.equal(picks.length, 1);
  assert.equal(picks[0]!.el, s.document.querySelector(".plan"));
  assert.equal(picks[0]!.ref.tag, "div");
});

test("clicks inside the overlay host are ignored by hover", () => {
  const picks: Element[] = [];
  const s = setup(`<button id="trial">Go</button>`, (_ref, el) => picks.push(el));
  s.overlay.store.set({ mode: "comment" });
  const host = s.document.getElementById(brand.hostId)!;
  assert.ok(host, "host element exists");

  const inside = s.fire(host, "click");
  s.fire(host, "mousemove");
  assert.equal(picks.length, 0);
  assert.equal(inside.defaultPrevented, false);
  assert.equal(s.root.querySelector(".tb-outline"), null);

  // Positive control: the same click on the page is picked and swallowed.
  const page = s.fire(s.document.getElementById("trial")!, "click");
  assert.equal(picks.length, 1);
  assert.equal(page.defaultPrevented, true);
});

test("a thread made on another page draws no pin and makes no lookup", () => {
  const s = setup(`<p id="a">a</p>`);
  const a = s.document.getElementById("a")!;
  setRect(a, { left: 10, top: 10, width: 40, height: 20 });
  const asked: string[] = [];
  const query = s.document.querySelector.bind(s.document);
  (s.document as any).querySelector = (q: string) => (asked.push(q), query(q));
  s.overlay.store.set({ threads: [thread(1, a, "pending", "http://x/other"), thread(2, a, "pending", "http://elsewhere/")] });
  assert.equal(s.root.querySelectorAll(".tb-pin").length, 0, "same selector, other page: no pin");
  assert.equal(asked.filter((q) => q === "#a").length, 0, "no lookup for other pages");

  s.overlay.store.set({ threads: [thread(3, a, "pending", "http://x/?tab=2#top")] });
  assert.equal(s.root.querySelectorAll(".tb-pin").length, 1, "query and hash are ignored");
});

test("a thread with an empty url is tried on this page", () => {
  const s = setup(`<p id="a">a</p>`);
  const a = s.document.getElementById("a")!;
  setRect(a, { left: 10, top: 10, width: 40, height: 20 });
  s.overlay.store.set({ threads: [thread(1, a, "pending", "")] });
  assert.equal(s.root.querySelectorAll(".tb-pin").length, 1);
});

test("scrolling does not search the page again for a kept or an unmatched element", () => {
  const s = setup(`<p id="a">a</p>`);
  const a = s.document.getElementById("a")!;
  setRect(a, { left: 10, top: 10, width: 40, height: 20 });
  const lost = thread(2, a);
  lost.element = { ...lost.element, selector: "#gone", text: "no such text" };
  const asked: string[] = [];
  const query = s.document.querySelector.bind(s.document);
  (s.document as any).querySelector = (q: string) => (asked.push(q), query(q));
  const count = (q: string) => asked.filter((x) => x === q).length;

  s.overlay.store.set({ threads: [thread(1, a), lost] });
  assert.equal(count("#a"), 1);
  assert.equal(count("#gone"), 1);
  for (let i = 0; i < 3; i++) s.win.dispatchEvent(new s.Event("scroll"));
  s.overlay.store.set({ mode: "comment" });
  assert.equal(count("#a"), 1, "kept element: no new search");
  assert.equal(count("#gone"), 1, "unmatched: no new search between polls");

  s.overlay.store.set({ threads: [thread(1, a), lost] });
  assert.equal(count("#a"), 1, "kept element survives a poll");
  assert.equal(count("#gone"), 2, "unmatched is searched once per poll");
});

test("a pin goes away when its element leaves the page", () => {
  const s = setup(`<p id="a">a</p>`);
  const a = s.document.getElementById("a")!;
  setRect(a, { left: 10, top: 10, width: 40, height: 20 });
  s.overlay.store.set({ threads: [thread(1, a)] });
  assert.equal(s.root.querySelectorAll(".tb-pin").length, 1);
  a.remove();
  s.win.dispatchEvent(new s.Event("scroll"));
  assert.equal(s.root.querySelectorAll(".tb-pin").length, 0);
});

test("dragging a box picks the smallest element that holds it; the click after the drag picks nothing", () => {
  const picks: { ref: ElementRef; el: Element }[] = [];
  const s = setup(`<div id="wrap"><p id="a">One</p><p id="b">Two</p></div>`, (ref, el) => picks.push({ ref, el }));
  const wrap = s.document.getElementById("wrap")!;
  const a = s.document.getElementById("a")!;
  const b = s.document.getElementById("b")!;
  setRect(wrap, { left: 0, top: 0, width: 200, height: 100 });
  setRect(a, { left: 0, top: 0, width: 200, height: 40 });
  setRect(b, { left: 0, top: 50, width: 200, height: 40 });
  // the topmost element at the box centre is the first paragraph, which does not hold the whole box
  (s.document as any).elementsFromPoint = () => [a, wrap];
  s.overlay.store.set({ mode: "comment" });
  s.fire(a, "mousedown", { clientX: 10, clientY: 10, button: 0 });
  s.fire(a, "mousemove", { clientX: 12, clientY: 12, buttons: 1 });
  assert.equal(s.root.querySelector(".tb-area"), null, "a small move is still a click");
  s.fire(b, "mousemove", { clientX: 150, clientY: 80, buttons: 1 });
  assert.ok(s.root.querySelector(".tb-area"), "the box shows while dragging");
  s.fire(b, "mouseup", { clientX: 150, clientY: 80 });
  assert.equal(s.root.querySelector(".tb-area"), null);
  assert.equal(picks.length, 1);
  assert.equal(picks[0]!.el, wrap);
  assert.equal(picks[0]!.ref.area, true);
  assert.deepEqual(picks[0]!.ref.rect, { x: 10, y: 10, w: 140, h: 70 });
  // both paragraphs look alike and the box covers most of each, so they come along, as removable chips
  assert.deepEqual(picks[0]!.ref.also?.map((e) => e.selector), ["#a", "#b"]);
  assert.equal(s.root.querySelectorAll(".tb-chip").length, 2);
  s.fire(b, "click");
  assert.equal(picks.length, 1, "the click that ends a drag is not a pick");
  s.overlay.store.set({ composing: false });
  s.fire(b, "mousedown", { clientX: 5, clientY: 60, button: 0 });
  s.fire(b, "mouseup", { clientX: 5, clientY: 60 });
  s.fire(b, "click");
  assert.equal(picks.length, 2, "a plain click still picks");
  assert.equal(picks[1]!.ref.area, undefined);
});

test("Shift+drag over text picks its element with the selected words", () => {
  const picks: { ref: ElementRef; el: Element }[] = [];
  const s = setup(`<p id="a">Hello <b>big</b> world</p>`, (ref, el) => picks.push({ ref, el }));
  const a = s.document.getElementById("a")!;
  setRect(a, { left: 0, top: 0, width: 200, height: 20 });
  let cleared = false;
  const range = { commonAncestorContainer: a.firstChild, getBoundingClientRect: () => ({ x: 5, y: 2, left: 5, top: 2, width: 60, height: 14 }) };
  (s.win as any).getSelection = () => ({
    rangeCount: 1, toString: () => "  Hello \n big ", getRangeAt: () => range, removeAllRanges: () => { cleared = true; },
  });
  s.overlay.store.set({ mode: "comment" });
  const down = s.fire(a, "mousedown", { clientX: 5, clientY: 5, button: 0, shiftKey: true });
  assert.equal(down.defaultPrevented, false, "Shift leaves native selection alone");
  s.fire(a, "mouseup", { clientX: 60, clientY: 5, shiftKey: true });
  assert.equal(picks.length, 1);
  assert.equal(picks[0]!.el, a);
  assert.equal(picks[0]!.ref.selection, "Hello big");
  assert.deepEqual(picks[0]!.ref.rect, { x: 5, y: 2, w: 60, h: 14 });
  assert.ok(cleared);
  s.fire(a, "click");
  assert.equal(picks.length, 1);
});

test("a box over mixed parts adds no extra elements, and a box over some of many cards names just those", () => {
  const s = setup(`<ul id="u"><li class="c" id="c1">A</li><li class="c" id="c2">B</li><li class="c" id="c3">C</li></ul><div id="m"><h2 id="h">T</h2><p id="p">x</p></div>`);
  const rect = (id: string, r: Rect) => setRect(s.document.getElementById(id)!, r);
  rect("c1", { left: 0, top: 0, width: 100, height: 50 });
  rect("c2", { left: 110, top: 0, width: 100, height: 50 });
  rect("c3", { left: 220, top: 0, width: 100, height: 50 });
  rect("h", { left: 0, top: 100, width: 100, height: 30 });
  rect("p", { left: 0, top: 140, width: 100, height: 30 });
  const u = s.document.getElementById("u")!;
  const m = s.document.getElementById("m")!;
  assert.deepEqual(siblingsInBox(u, { x: 5, y: 5, w: 210, h: 40 }).map((e) => e.id), ["c1", "c2"]);
  assert.deepEqual(siblingsInBox(u, { x: 5, y: 5, w: 90, h: 40 }), [], "one card is not a list");
  assert.deepEqual(siblingsInBox(m, { x: 0, y: 100, w: 100, h: 70 }), [], "a heading and a paragraph differ");
});
