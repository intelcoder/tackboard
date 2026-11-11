import { test } from "node:test";
import assert from "node:assert/strict";
import { brand } from "@app/shared";
import { pairSites, pick, scan } from "../src/discover.ts";
import { isLocalKey, siteKey } from "../src/sites.ts";

const pairAnswer = { pair: 1, token: "tok", dir: "/p" };
// One daemon, on the first port of the range; the other ports refuse.
const daemon = (answer: unknown, ok = true) =>
  (async (url: string) => {
    if (new URL(url).port !== String(brand.pairPort)) throw new Error("refused");
    return { ok, json: async () => answer };
  }) as unknown as typeof fetch;
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

test("scan asks every port of the range with POST and accepts only our daemon's answer", async () => {
  const asked: string[] = [];
  let method = "";
  const spy = (async (url: string, init: RequestInit) => (asked.push(url), (method = init.method ?? "GET"), { ok: true, json: async () => pairAnswer })) as unknown as typeof fetch;
  const found = await scan(spy);
  assert.deepEqual(found.map((d) => d.port), Array.from({ length: brand.pairSpan }, (_, i) => brand.pairPort + i));
  assert.deepEqual(asked.sort(), found.map((d) => `http://127.0.0.1:${d.port}${brand.pairPath}`).sort());
  assert.equal(method, "POST", "Chrome sends no Origin on a GET from an extension; the daemon needs one");
  assert.deepEqual(await scan(daemon({ hello: 1 })), []);
  assert.deepEqual(await scan(daemon(pairAnswer, false)), []);
  assert.deepEqual(await scan(down), []);
});

/** Two projects: a daemon on the first port for http://localhost:3000, one on the second for http://localhost:4000. */
const twoProjects = (async (url: string) => {
  const port = Number(new URL(url).port);
  const mine = { [brand.pairPort]: { token: "a", dir: "/a", origins: ["http://localhost:3000"] }, [brand.pairPort + 1]: { token: "b", dir: "/b", origins: ["http://localhost:4000"] } }[port];
  if (!mine) throw new Error("refused");
  return { ok: true, json: async () => ({ pair: 1, port, ...mine }) };
}) as unknown as typeof fetch;

test("with two daemons, a page pairs with the one whose origins include it", async () => {
  const a = await pairSites({}, "http://localhost:3000/x", twoProjects);
  assert.deepEqual(a["http://localhost:3000"], { daemon: `http://127.0.0.1:${brand.pairPort}`, token: "a", on: true });
  const b = await pairSites({}, "http://localhost:4000/", twoProjects);
  assert.deepEqual(b["http://localhost:4000"], { daemon: `http://127.0.0.1:${brand.pairPort + 1}`, token: "b", on: true });
});

test("with two daemons and no match, nothing pairs; with one daemon and no match (or an old daemon that lists no origins), it does", async () => {
  const sites = {};
  assert.equal(await pairSites(sites, "http://localhost:5000/", twoProjects), sites, "a guess would save comments in the wrong project");
  assert.ok((await pairSites({}, "http://localhost:5000/", daemon({ ...pairAnswer, origins: ["http://localhost:3000"] })))["http://localhost:5000"]);
  assert.ok((await pairSites({}, "http://localhost:5000/", daemon(pairAnswer)))["http://localhost:5000"]);
});

test("pick: a file:// page matches an origin of file:// or null", () => {
  const found = [{ port: 1, token: "x", dir: "/x", origins: ["http://localhost:3000"] }, { port: 2, token: "y", dir: "/y", origins: ["null"] }];
  assert.equal(pick(found, "file://")?.port, 2);
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
