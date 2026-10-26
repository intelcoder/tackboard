import { test } from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { parentsOf, buildElementRef, labelFor } from "../src/element_ref.ts";
import { createStore } from "../src/store.ts";
import { createFinder } from "../src/element_ref.ts";

function dom(body: string) {
  const { document } = parseHTML(`<html><body>${body}</body></html>`);
  return document as unknown as Document;
}

function lookup(element: any, doc: Document): Element | null {
  const store = createStore();
  const t = { id: "t", url: "", element } as any;
  store.set({ threads: [t] });
  return createFinder(doc, { location: { href: "http://x/" } } as unknown as Window, store).find(t);
}

test("buildElementRef + lookup round-trips for an element with an id and one without", () => {
  const doc = dom(`<div id="app"><section><p>one</p><p>two</p></section><button id="cta">Buy</button></div>`);
  const cta = doc.getElementById("cta")!;
  const refCta = buildElementRef(cta);
  assert.equal(refCta.selector, "#cta");
  assert.equal(refCta.tag, "button");
  assert.equal(refCta.text, "Buy");
  assert.equal(refCta.confidence, "text");
  assert.equal(lookup(refCta, doc), cta);

  const second = doc.querySelectorAll("p")[1]!;
  const ref = buildElementRef(second);
  assert.equal(doc.querySelectorAll(ref.selector).length, 1);
  assert.equal(lookup(ref, doc), second);
});

test("finder: falls back to tag plus text when the nth-child path no longer matches", () => {
  const doc = dom(`<div id="app"><section><p>one</p><p>two</p></section></div>`);
  const second = doc.querySelectorAll("p")[1]!;
  const ref = buildElementRef(second);
  // A new first child shifts section from nth-child(1) to nth-child(2): the stored path is dead.
  const app = doc.getElementById("app")!;
  app.insertBefore(doc.createElement("div"), app.firstChild);
  assert.equal(doc.querySelector(ref.selector), null);
  assert.equal(lookup(ref, doc), second);
});

test("finder: returns null when nothing matches", () => {
  const doc = dom(`<div id="app"><p>one</p></div>`);
  const ref = { ...buildElementRef(doc.querySelector("p")!), selector: "#nope", text: "never written" };
  assert.equal(lookup(ref, doc), null);
});

test("parentsOf excludes the root and starts at the innermost", () => {
  const doc = dom(`<div id="a"><div id="b"><span id="c">x</span></div></div>`);
  const chain = parentsOf(doc.getElementById("c")!, doc.body);
  assert.deepEqual(chain.map((e) => e.id), ["c", "b", "a"]);
  assert.deepEqual(parentsOf(doc.body, doc.body), []);
});

test("html longer than 4 KB is truncated", () => {
  const doc = dom(`<div id="big"></div>`);
  const big = doc.getElementById("big")!;
  big.textContent = "x".repeat(1_000_000);
  const ref = buildElementRef(big);
  assert.ok(ref.html.length <= 4096, `html length ${ref.html.length}`);
  assert.ok(ref.html.length > 4000);
  assert.ok(ref.text.length <= 120);
});

test("labelFor names tag, id and first class", () => {
  const doc = dom(`<button id="cta" class="x">Go</button><div class="card big">c</div><p>p</p>`);
  assert.equal(labelFor(doc.getElementById("cta")!), "button#cta");
  assert.equal(labelFor(doc.querySelector("div")!), "div.card");
  assert.equal(labelFor(doc.querySelector("p")!), "p");
});

test("the text fallback ignores spacing, takes the first element in document order and never matches long text", () => {
  const doc = dom(`<div id="app"><p>  Buy \n now </p><div><div>same</div></div><p>other</p></div>`);
  const stale = (el: Element) => ({ ...buildElementRef(el), selector: "#nope" });
  assert.equal(lookup(stale(doc.querySelector("p")!), doc), doc.querySelector("p"));
  const outer = doc.querySelector("div div")!;
  assert.equal(lookup(stale(outer), doc), outer, "outer of two nested same-text divs comes first");
  const long = { ...stale(outer), text: "x".repeat(200) };
  assert.equal(lookup(long, doc), null);
});

function finderFor(body: string, url = "http://x/") {
  const doc = dom(body);
  const store = createStore();
  const win = { location: { href: url } } as unknown as Window;
  const asked: string[] = [];
  const query = doc.querySelector.bind(doc);
  (doc as any).querySelector = (q: string) => (asked.push(q), query(q));
  const finder = createFinder(doc, win, store);
  const make = (id: string, el: Element, pageUrl = url) =>
    ({ id, url: pageUrl, element: buildElementRef(el) }) as any;
  return { doc, store, finder, asked, make };
}

test("finder: another page gets no lookup, a kept element is not searched again, a removed one is dropped", () => {
  const f = finderFor(`<p id="a">a</p>`);
  const a = f.doc.getElementById("a")!;
  const here = f.make("t1", a);
  const away = f.make("t2", a, "http://x/other");
  f.store.set({ threads: [here, away] });
  assert.equal(f.finder.find(away), null);
  assert.equal(f.asked.length, 0);
  assert.equal(f.finder.find(here), a);
  assert.equal(f.finder.find(here), a);
  assert.equal(f.asked.length, 1);
  a.remove();
  assert.equal(f.finder.find(here), null);
});

test("finder: an empty url is looked up on this page", () => {
  const f = finderFor(`<p id="a">a</p>`);
  const a = f.doc.getElementById("a")!;
  const agent = { ...f.make("t1", a, ""), element: { ...buildElementRef(a), tag: "", text: "" } };
  f.store.set({ threads: [agent] });
  assert.equal(f.finder.find(agent), a);
});

test("finder: an unmatched thread is searched once per thread list", () => {
  const f = finderFor(`<p id="a">a</p>`);
  const lost = { ...f.make("t1", f.doc.getElementById("a")!), element: { ...buildElementRef(f.doc.getElementById("a")!), selector: "#gone", text: "nope" } };
  f.store.set({ threads: [lost] });
  f.finder.find(lost);
  f.finder.find(lost);
  assert.equal(f.asked.length, 1);
  f.store.set({ threads: [lost] });
  f.finder.find(lost);
  assert.equal(f.asked.length, 2);
});
