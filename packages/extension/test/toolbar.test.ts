import { test } from "node:test";
import assert from "node:assert/strict";
import { badgeFor, whatClickDoes } from "../src/toolbar.ts";
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

test("a click on chrome://, about:, file: and no address asks to add with no site", () => {
  for (const address of ["chrome://version", "about:blank", "file:///tmp/a.html", "chrome-extension://abc/options.html", undefined]) {
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
