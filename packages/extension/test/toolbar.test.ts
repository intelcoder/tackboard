import { test } from "node:test";
import assert from "node:assert/strict";
import { badgeFor, badgeNeedsUpdate, linkFrom, whatClickDoes } from "../src/toolbar.ts";
import type { Sites } from "../src/sites.ts";

const on = { daemon: "http://127.0.0.1:1", token: "t", on: true };
const sites: Sites = { "https://xxx.com": on, "http://localhost:4321": { ...on, on: false } };

test("a click on a saved site that is on turns it off", () => {
  assert.deepEqual(whatClickDoes(sites, "https://xxx.com/some/page?x=1"), { kind: "flip", origin: "https://xxx.com", on: false });
});

test("a click on a saved site that is off turns it on", () => {
  assert.deepEqual(whatClickDoes(sites, "http://localhost:4321/"), { kind: "flip", origin: "http://localhost:4321", on: true });
});

test("a click on a page that was not added asks to add that origin, with its port", () => {
  assert.deepEqual(whatClickDoes(sites, "http://localhost:5000/a/b"), { kind: "add", site: "http://localhost:5000" });
  assert.deepEqual(whatClickDoes(sites, "https://other.com/"), { kind: "add", site: "https://other.com" });
});

test("a click on a page of the same host on another port is not the saved site", () => {
  assert.deepEqual(whatClickDoes(sites, "http://localhost:4322/"), { kind: "add", site: "http://localhost:4322" });
});

test("a click on chrome://, about: and no address asks to add with no site", () => {
  for (const address of ["chrome://version", "about:blank", "chrome-extension://abc/options.html", undefined]) {
    assert.deepEqual(whatClickDoes(sites, address), { kind: "add" }, String(address));
  }
});

test("the badge says ON, OFF or nothing, and the words differ, and the title says what a click does", () => {
  const yes = badgeFor(sites, "https://xxx.com/");
  const no = badgeFor(sites, "http://localhost:4321/");
  const none = badgeFor(sites, "https://other.com/");
  assert.equal(yes.text, "ON");
  assert.equal(no.text, "OFF");
  assert.equal(none.text, "");
  assert.notEqual(yes.color, no.color);
  assert.match(yes.title, /Click to turn it off/);
  assert.match(no.title, /Click to turn it on/);
  assert.match(none.title, /Click to add this site/);
  assert.equal(badgeFor(sites, undefined).text, "");
});

test("a page with no readable address or not a web page gets the site list title", () => {
  for (const address of ["chrome://version", "about:blank", "chrome-extension://abc/options.html", undefined]) {
    const badge = badgeFor(sites, address);
    assert.equal(badge.text, "", String(address));
    assert.match(badge.title, /click to open the site list/, String(address));
    assert.doesNotMatch(badge.title, /add this site/, String(address));
  }
});

test("a web page that is not added keeps the add this site title", () => {
  assert.match(badgeFor(sites, "https://other.com/page").title, /Click to add this site/);
});

test("badgeNeedsUpdate is true for a url or a status and false for a title, an icon or sound change", () => {
  assert.equal(badgeNeedsUpdate({ url: "https://xxx.com/" }), true);
  assert.equal(badgeNeedsUpdate({ status: "loading" }), true);
  assert.equal(badgeNeedsUpdate({ status: "complete" }), true);
  for (const change of [{ title: "New" }, { favIconUrl: "x.png" }, { audible: true }, {}]) assert.equal(badgeNeedsUpdate(change), false);
});

test("the badge turns amber with no agent, red with no daemon, and stays green while one listens or is idle", () => {
  const at = "https://xxx.com/";
  const state = (kind: "listening" | "idle" | "away" | "none") => ({ kind, label: kind, hint: `hint ${kind}` });
  assert.equal(badgeFor(sites, at, state("listening")).text, "ON");
  assert.equal(badgeFor(sites, at, state("idle")).text, "ON");
  assert.match(badgeFor(sites, at, state("idle")).title, /hint idle/);
  for (const kind of ["away", "none"] as const) {
    const b = badgeFor(sites, at, state(kind));
    assert.equal(b.text, "ON?");
    assert.match(b.title, new RegExp(`no agent is listening. hint ${kind}`));
  }
  const bad = badgeFor(sites, at, "unreachable");
  assert.equal(bad.text, "!");
  assert.match(bad.title, /doctor/);
  assert.notEqual(bad.color, badgeFor(sites, at, state("none")).color);
  assert.equal(badgeFor(sites, "http://localhost:4321/", "unreachable").text, "OFF", "a site that is off shows OFF whatever the daemon says");
});

test("linkFrom: a good list gives the agent state; a refused token, a daemon error or no daemon give unreachable; other bodies say nothing", () => {
  const list = (seenAt: number | null) => ({ status: 200, text: JSON.stringify({ agent: { name: "claude", online: false, seenAt }, threads: [] }) });
  assert.equal((linkFrom(list(null), 1000) as { kind: string }).kind, "none");
  assert.equal((linkFrom(list(900), 1000) as { kind: string }).kind, "listening");
  for (const bad of [{ status: 401, text: "{}" }, { status: 403, text: "{}" }, { status: 500, text: "" }, { error: "Cannot reach the daemon" }]) {
    assert.equal(linkFrom(bad, 1000), "unreachable", JSON.stringify(bad));
  }
  assert.equal(linkFrom({ status: 200, text: "not json" }, 1000), undefined);
  assert.equal(linkFrom(true, 1000), undefined, "the is_on answer is a boolean");
  assert.equal(linkFrom(null, 1000), undefined);
});
