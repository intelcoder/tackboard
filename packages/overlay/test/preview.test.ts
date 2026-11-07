import { test } from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { fillPreview } from "../src/preview.ts";

const doc = (html: string) => parseHTML(html).document as unknown as Document;
const page = () => doc(`<html class="root"><head><link rel="stylesheet" href="/a.css"><style>.card{color:red}</style></head>
<body class="b"><div class="page"><section id="s"><article class="card" style="margin:9px">Hi<script>alert(1)</script><iframe src="x"></iframe></article></section></div></body></html>`);

test("fillPreview keeps styles, ancestor classes and the target; drops scripts", () => {
  const from = page();
  const into = doc("<html><head></head><body></body></html>");
  const clone = fillPreview(into, from, from.querySelector(".card")!, 200)!;
  assert.ok(clone);
  assert.equal(into.querySelector("link")!.getAttribute("href"), "/a.css");
  assert.equal(into.querySelector("style")!.textContent, ".card{color:red}");
  assert.equal(into.documentElement.getAttribute("class"), "root");
  assert.equal(into.querySelector("body.b > div.page > section#s > article.card[data-tb-target]"), clone);
  assert.match(clone.getAttribute("style")!, /width:200px/);
  assert.equal(into.querySelectorAll("script, iframe").length, 0);
});

test("fillPreview gives up on a huge element", () => {
  const from = page();
  const card = from.querySelector(".card")!;
  for (let i = 0; i < 700; i++) card.append(from.createElement("i"));
  assert.equal(fillPreview(doc("<html><head></head><body></body></html>"), from, card, 100), null);
});
