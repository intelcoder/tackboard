import { test } from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { brand } from "@app/shared";
import { buildElementRef } from "../src/element_ref.ts";
import { readSourceInfo } from "../src/source_map.ts";

function dom(body: string) {
  const { document } = parseHTML(`<html><body>${body}</body></html>`);
  return document as unknown as Document;
}

/** A fake fiber chain: the innermost fiber first, each pointing at its parent through `return`. */
function fiberChain(...types: unknown[]) {
  let parent: unknown = null;
  for (const type of types.reverse()) parent = { type, return: parent };
  return parent;
}
function PricingPage() {}
function PlanCard() {}

test("source from the data attribute wins and reports confidence \"source\"", () => {
  const doc = dom(`<div ${brand.sourceAttr}="src/PlanCard.tsx:48"><button id="b">Buy</button></div>`);
  const el = doc.getElementById("b")!;
  (el as any)["__reactFiber$abc"] = fiberChain("button", PlanCard, PricingPage);
  const info = readSourceInfo(el);
  assert.equal(info.confidence, "source");
  assert.equal(info.source, "src/PlanCard.tsx:48");
  assert.deepEqual(info.component, ["PricingPage", "PlanCard"]);
});

test("fiber names produce [\"PricingPage\",\"PlanCard\"] with confidence \"component\"", () => {
  const doc = dom(`<button id="b">Buy</button>`);
  const el = doc.getElementById("b")!;
  (el as any)["__reactFiber$xyz"] = fiberChain("button", PlanCard, "div", PricingPage, null);
  const info = readSourceInfo(el);
  assert.deepEqual(info.component, ["PricingPage", "PlanCard"]);
  assert.equal(info.source, undefined);
  assert.equal(info.confidence, "component");
});

test("fiber reading skips anonymous functions and reads memo, forwardRef and displayName types", () => {
  const doc = dom(`<p id="p">x</p>`);
  const el = doc.getElementById("p")!;
  const Memoed = { type: function Inner() {} };
  const Forwarded = { render: function Fancy() {} };
  const Shown = { displayName: "Shown" };
  (el as any)["__reactFiber$k"] = fiberChain("p", Shown, Forwarded, Memoed, () => {}, PricingPage);
  assert.deepEqual(readSourceInfo(el).component, ["PricingPage", "Inner", "Fancy", "Shown"]);
});

test("a plain element inside a React element uses the nearest fiber above it", () => {
  const doc = dom(`<div id="host"><span id="inner">x</span></div>`);
  (doc.getElementById("host") as any)["__reactFiber$k"] = fiberChain("div", PlanCard);
  assert.deepEqual(readSourceInfo(doc.getElementById("inner")!).component, ["PlanCard"]);
});

test("plain DOM yields confidence \"text\"", () => {
  const doc = dom(`<p id="p">hello</p>`);
  const info = readSourceInfo(doc.getElementById("p")!);
  assert.deepEqual(info, { confidence: "text" });
});

test("a broken fiber does not throw and falls back to text", () => {
  const doc = dom(`<p id="p">hello</p>`);
  const el = doc.getElementById("p")!;
  (el as any)["__reactFiber$k"] = { type: PlanCard, get return() { throw new Error("boom"); } };
  assert.equal(readSourceInfo(el).confidence, "text");
});

test("the nearest ancestor attribute is used", () => {
  const doc = dom(
    `<div ${brand.sourceAttr}="far.tsx:1"><section ${brand.sourceAttr}="near.tsx:9"><i id="x">z</i></section></div>`,
  );
  assert.equal(readSourceInfo(doc.getElementById("x")!).source, "near.tsx:9");
});

test("buildElementRef carries component, source and confidence", () => {
  const doc = dom(`<div ${brand.sourceAttr}="a.tsx:3"><button id="b">Buy</button></div>`);
  const el = doc.getElementById("b")!;
  (el as any)["__reactFiber$k"] = fiberChain("button", PlanCard);
  const ref = buildElementRef(el);
  assert.equal(ref.confidence, "source");
  assert.equal(ref.source, "a.tsx:3");
  assert.deepEqual(ref.component, ["PlanCard"]);
  const plain = buildElementRef(dom(`<p id="p">x</p>`).getElementById("p")!);
  assert.equal(plain.confidence, "text");
  assert.equal("source" in plain, false);
  assert.equal("component" in plain, false);
});

test("a real React 18 element: names come from the fiber React really sets", async () => {
  const { document, window } = parseHTML(`<html><body><div id="root"></div></body></html>`);
  // react-dom reads window.location and navigator.userAgent when it loads; linkedom gives neither
  Object.defineProperty(window, "location", { value: { protocol: "http:" }, configurable: true });
  Object.defineProperty(window.navigator, "userAgent", { value: "linkedom", configurable: true });
  const keep: Record<string, unknown> = {};
  for (const [k, v] of Object.entries({ window, document, navigator: window.navigator })) {
    keep[k] = Object.getOwnPropertyDescriptor(globalThis, k);
    Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true });
  }
  try {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    // no type packages are installed for react, so load it untyped
    const load = (name: string): Promise<any> => import(name);
    const React = (await load("react")).default;
    const { flushSync } = await load("react-dom");
    const { createRoot } = await load("react-dom/client");
    function PlanCardReal() {
      return React.createElement("button", { id: "go" }, "Buy");
    }
    function PricingPageReal() {
      return React.createElement("main", null, React.createElement(PlanCardReal));
    }
    const root = createRoot(document.getElementById("root") as any);
    flushSync(() => root.render(React.createElement(PricingPageReal)));
    const info = readSourceInfo(document.getElementById("go") as unknown as Element);
    assert.deepEqual(info.component, ["PricingPageReal", "PlanCardReal"]);
    assert.equal(info.confidence, "component");
    flushSync(() => root.unmount());
  } finally {
    for (const [k, d] of Object.entries(keep)) {
      if (d) Object.defineProperty(globalThis, k, d as PropertyDescriptor);
      else delete (globalThis as any)[k];
    }
  }
});
