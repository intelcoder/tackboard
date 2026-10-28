import { test } from "node:test";
import assert from "node:assert/strict";
import { patternStillUsed, readConfigText, siteFrom } from "../src/sites.ts";

test("siteFrom accepts https://xxx.com, xxx.com and localhost:4321 with the right origin and pattern", () => {
  assert.deepEqual(siteFrom("https://xxx.com"), { origin: "https://xxx.com", pattern: "https://xxx.com/*" });
  assert.deepEqual(siteFrom("xxx.com"), { origin: "https://xxx.com", pattern: "https://xxx.com/*" });
  assert.deepEqual(siteFrom("localhost:4321"), { origin: "http://localhost:4321", pattern: "http://localhost/*" });
  assert.deepEqual(siteFrom("127.0.0.1:5000"), { origin: "http://127.0.0.1:5000", pattern: "http://127.0.0.1/*" });
});

test("siteFrom refuses a path, a query, a user name, ftp:, * and empty text", () => {
  for (const text of ["https://xxx.com/page", "https://xxx.com?a=1", "https://me@xxx.com", "ftp://xxx.com", "*.xxx.com", "https://*", "", "   ", "https://-", "https://...", "https://dot.test.", "https://-a.test", "https://a-.test", "https://a..test", `https://${"a".repeat(254)}`]) {
    assert.ok("error" in siteFrom(text), `should refuse: ${text}`);
  }
});

test("siteFrom keeps the port in the origin and leaves it out of the pattern", () => {
  assert.deepEqual(siteFrom("https://dev.example.test:8443"), { origin: "https://dev.example.test:8443", pattern: "https://dev.example.test/*" });
});

test("readConfigText reads port and token into a daemon address", () => {
  assert.deepEqual(readConfigText('{"port": 4321, "token": "abc", "origins": []}'), { daemon: "http://127.0.0.1:4321", token: "abc" });
});

test("readConfigText refuses text that is not JSON", () => {
  assert.ok("error" in readConfigText("port 4321"));
});

test("readConfigText refuses a bad port or a missing token", () => {
  for (const text of ['{"port": 0, "token": "a"}', '{"port": 70000, "token": "a"}', '{"port": 1.5, "token": "a"}', '{"port": "80", "token": "a"}', '{"port": 80}', '{"port": 80, "token": ""}', "null"]) {
    assert.ok("error" in readConfigText(text), `should refuse: ${text}`);
  }
});

test("patternStillUsed counts other sites with the same pattern", () => {
  const site = { daemon: "http://127.0.0.1:1", token: "t", on: true };
  const sites = { "http://localhost:3000": site, "http://localhost:4000": site, "https://a.com": site };
  assert.equal(patternStillUsed(sites, "http://localhost/*"), true);
  assert.equal(patternStillUsed({ "https://a.com": site }, "http://localhost/*"), false);
  assert.equal(patternStillUsed({}, "https://a.com/*"), false);
});
