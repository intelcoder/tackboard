import { test } from "node:test";
import assert from "node:assert/strict";
import { brand } from "@app/shared";
import { pairSites, scan } from "../src/discover.ts";
import { isLocalKey, siteKey } from "../src/sites.ts";

const pairAnswer = { pair: 1, token: "tok", dir: "/p" };
const daemon = (answer: unknown, ok = true) => (async () => ({ ok, json: async () => answer })) as unknown as typeof fetch;
const down = (async () => {
  throw new Error("refused");
}) as unknown as typeof fetch;

test("siteKey and isLocalKey: files share one key, localhost keeps its port, other pages are not local", () => {
  assert.equal(siteKey("file:///Users/a/b.html"), "file://");
  assert.equal(siteKey("http://localhost:6007/x?y"), "http://localhost:6007");
  assert.equal(siteKey("chrome://version"), undefined);
  assert.ok(isLocalKey("file://") && isLocalKey("http://127.0.0.1:3000") && isLocalKey("http://localhost"));
  assert.ok(!isLocalKey("https://localhost:3000") && !isLocalKey("http://xxx.com") && !isLocalKey(undefined));
});

test("scan asks the fixed port and accepts only our daemon's answer", async () => {
  let asked = "";
  let method = "";
  const spy = (async (url: string, init: RequestInit) => ((asked = url), (method = init.method ?? "GET"), { ok: true, json: async () => pairAnswer })) as unknown as typeof fetch;
  assert.deepEqual(await scan(spy), { port: brand.pairPort, token: "tok", dir: "/p" });
  assert.equal(asked, `http://127.0.0.1:${brand.pairPort}${brand.pairPath}`);
  assert.equal(method, "POST", "Chrome sends no Origin on a GET from an extension; the daemon needs one");
  assert.equal(await scan(daemon({ hello: 1 })), undefined);
  assert.equal(await scan(daemon(pairAnswer, false)), undefined);
  assert.equal(await scan(down), undefined);
});

test("a local page is added on, with no config", async () => {
  const sites = await pairSites({}, "http://localhost:6007/", daemon(pairAnswer));
  assert.deepEqual(sites["http://localhost:6007"], { daemon: `http://127.0.0.1:${brand.pairPort}`, token: "tok", on: true });
  assert.ok((await pairSites({}, "file:///tmp/a.html", daemon(pairAnswer)))["file://"]!.on);
});

test("no daemon, or a page that is not local, changes nothing", async () => {
  const sites = {};
  assert.equal(await pairSites(sites, "http://localhost:6007/", down), sites);
  assert.equal(await pairSites(sites, "https://xxx.com/", daemon(pairAnswer)), sites);
});

test("a changed token is refreshed, the same one returns the same object, and a site turned off stays off", async () => {
  const saved = { "http://localhost:6007": { daemon: `http://127.0.0.1:${brand.pairPort}`, token: "old", on: false } };
  const next = await pairSites(saved, "http://localhost:6007/", daemon(pairAnswer));
  assert.deepEqual(next["http://localhost:6007"], { daemon: `http://127.0.0.1:${brand.pairPort}`, token: "tok", on: false });
  assert.equal(await pairSites(next, "http://localhost:6007/", daemon(pairAnswer)), next);
});
