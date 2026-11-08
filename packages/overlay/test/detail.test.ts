import { test } from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { attrBits, box4, hex, safeHtml, siblingDiff, styleTokens, treeOf } from "../src/detail.ts";

const dom = (html: string) => parseHTML(`<html><body>${html}</body></html>`).document as unknown as Document;

test("hex turns rgb and rgba into hex and fully transparent into transparent", () => {
  assert.equal(hex("rgb(42, 33, 24)"), "#2a2118");
  assert.equal(hex("rgba(0, 0, 0, 0.5)"), "#00000080");
  assert.equal(hex("rgba(0, 0, 0, 0)"), "transparent");
  assert.equal(hex("rgb(0 0 0 / 50%)"), "#00000080");
  assert.equal(hex("red"), "red");
});

test("box4 gives the shortest shorthand and nothing for all zeros", () => {
  assert.equal(box4("0", "0", "0", "0"), "");
  assert.equal(box4("8", "8", "8", "8"), "8");
  assert.equal(box4("8", "16", "8", "16"), "8 16");
  assert.equal(box4("16", "0", "0", "0"), "16 0 0 0");
});

const reading = (values: Record<string, string>) => (prop: string) => values[prop] ?? "";
const base = { "font-size": "16px", color: "rgb(42, 33, 24)", display: "block", "margin-top": "0px", "margin-right": "0px", "margin-bottom": "0px", "margin-left": "0px", "padding-top": "0px", "padding-right": "0px", "padding-bottom": "0px", "padding-left": "0px", "border-top-style": "none", "border-top-width": "0px", "font-weight": "400", "font-family": "Nunito, sans-serif", "line-height": "normal", position: "static", "row-gap": "normal", "column-gap": "normal", "z-index": "auto", opacity: "1", "border-top-left-radius": "0px" };

test("styleTokens always has size, colour, background and display, and leaves out defaults", () => {
  const t = styleTokens(reading(base), null, "#fff");
  assert.deepEqual(t, { "font-size": "16", color: "#2a2118", bg: "#fff", display: "block", font: "Nunito" });
});

test("styleTokens reports spacing, border, weight, gap and grid columns when they are set", () => {
  const t = styleTokens(reading({ ...base, "margin-top": "16px", "padding-top": "24px", "padding-bottom": "24px", "padding-left": "20px", "padding-right": "20px", "border-top-style": "solid", "border-top-width": "1px", "border-top-color": "rgb(0, 0, 0)", "font-weight": "700", display: "grid", "grid-template-columns": "275px 275px 275px", "row-gap": "16px", "column-gap": "16px" }), reading(base), "#fff");
  assert.equal(t.margin, "16 0 0 0");
  assert.equal(t.padding, "24 20");
  assert.equal(t.border, "1 solid #000000");
  assert.equal(t.weight, "700");
  assert.equal(t.gap, "16");
  assert.equal(t.cols, "3");
});

test("siblingDiff lists what differs from the most common sibling value, and says nothing when there are no like siblings", () => {
  const self = { margin: "16 0 0 0", padding: "24 20", color: "#000" };
  const sib = { padding: "16", color: "#000" };
  assert.deepEqual(siblingDiff(self, [sib, sib]), ["margin 16 0 0 0 (siblings none)", "padding 24 20 (siblings 16)"]);
  assert.deepEqual(siblingDiff(sib, [sib]), []);
  assert.equal(siblingDiff(self, []), null);
});

test("treeOf outlines children with classes, attributes and text, and says how many it cut", () => {
  const d = dom(`<ul id="l" class="menu big"><li class="a"><a href="/order.html?x=1" target="_blank">Order</a></li><li>Two</li><script>x()</script></ul>`);
  assert.deepEqual(treeOf(d.querySelector("#l")!), [
    "ul#l.menu.big",
    "├ li.a",
    "│ └ a [href=/order.html?… target=_blank] \"Order\"",
    "└ li \"Two\"",
  ]);
  const many = dom(`<div id="r">${"<p>x</p>".repeat(30)}</div>`);
  const lines = treeOf(many.querySelector("#r")!);
  assert.equal(lines.length, 15);
  assert.match(lines.at(-1)!, /… \+17 more$/);
});

test("attrBits keeps what changes behaviour, drops origins and query strings, and cuts long values", () => {
  const d = dom(`<a id="x" href="https://shop.test/cart?token=abc" disabled aria-label="${"y".repeat(50)}">go</a>`);
  assert.equal(attrBits(d.querySelector("#x")!), ` [href=/cart?… aria-label=${"y".repeat(30)} disabled]`);
});

test("safeHtml removes what people typed, credentials, query strings, data addresses, emails and tokens", () => {
  const d = dom(`<form id="f" data-csrf-token="abc123" class="c"><input name="n" value="Sam Rivera"><input type="submit" value="Send"><input type="password" value="hunter2"><textarea>call me at 555 014 2000</textarea><a href="/p?e=sam@x.io#h">mail sam@example.com</a><img src="data:image/png;base64,AAAA" alt="k"><p>key sk-live_abcdefghijklmnop1234</p></form>`);
  const out = safeHtml(d.querySelector("#f")!);
  assert.ok(!/Sam Rivera|hunter2|555 014|sam@|AAAA|abc123|sk-live/.test(out), out);
  assert.match(out, /value="Send"/);
  assert.match(out, /data-csrf-token="\[redacted\]"/);
  assert.match(out, /href="\/p\?…"/);
  assert.match(out, /mail \[email\]/);
  assert.match(out, /src="data:…\(\d+ chars\)"/);
  assert.match(out, /class="c"/);
  assert.match(out, /\[input\]/);
});
