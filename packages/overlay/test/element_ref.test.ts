import { test } from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { ancestorChain, buildElementRef, findElement, labelFor } from "../src/element_ref.ts";

function dom(body: string) {
  const { document } = parseHTML(`<html><body>${body}</body></html>`);
  return document as unknown as Document;
}

test("buildElementRef + findElement round-trips for an element with an id and one without", () => {
  const doc = dom(`<div id="app"><section><p>one</p><p>two</p></section><button id="cta">Buy</button></div>`);
  const cta = doc.getElementById("cta")!;
  const refCta = buildElementRef(cta);
  assert.equal(refCta.selector, "#cta");
  assert.equal(refCta.tag, "button");
  assert.equal(refCta.text, "Buy");
  assert.equal(refCta.confidence, "text");
  assert.equal(findElement(refCta, doc), cta);

  const second = doc.querySelectorAll("p")[1]!;
  const ref = buildElementRef(second);
  assert.equal(doc.querySelectorAll(ref.selector).length, 1);
  assert.equal(findElement(ref, doc), second);
});

test("findElement falls back to tag plus text when the nth-child path no longer matches", () => {
  const doc = dom(`<div id="app"><section><p>one</p><p>two</p></section></div>`);
  const second = doc.querySelectorAll("p")[1]!;
  const ref = buildElementRef(second);
  // A new first child shifts section from nth-child(1) to nth-child(2): the stored path is dead.
  const app = doc.getElementById("app")!;
  app.insertBefore(doc.createElement("div"), app.firstChild);
  assert.equal(doc.querySelector(ref.selector), null);
  assert.equal(findElement(ref, doc), second);
});

test("findElement returns null when nothing matches", () => {
  const doc = dom(`<div id="app"><p>one</p></div>`);
  const ref = { ...buildElementRef(doc.querySelector("p")!), selector: "#nope", text: "never written" };
  assert.equal(findElement(ref, doc), null);
});

test("ancestorChain excludes the root and starts at the innermost", () => {
  const doc = dom(`<div id="a"><div id="b"><span id="c">x</span></div></div>`);
  const chain = ancestorChain(doc.getElementById("c")!, doc.body);
  assert.deepEqual(chain.map((e) => e.id), ["c", "b", "a"]);
  assert.deepEqual(ancestorChain(doc.body, doc.body), []);
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
