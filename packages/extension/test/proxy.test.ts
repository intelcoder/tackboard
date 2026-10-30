import { test } from "node:test";
import assert from "node:assert/strict";
import { brand } from "@app/shared";
import { answerMessage, answerScreenshot, callDaemon } from "../src/proxy.ts";

const origin = "https://dev.example.test";
const sites = { [origin]: { daemon: "http://127.0.0.1:4321", token: "secret", on: true } };

type Seen = { url: string; init: RequestInit };
function fakeFetch(answer: () => Response | Promise<Response>) {
  const seen: Seen[] = [];
  const fetchFn = (async (url: string | URL, init: RequestInit) => {
    seen.push({ url: String(url), init });
    return answer();
  }) as typeof fetch;
  return { seen, fetchFn };
}

test("call adds the token header and sends the body", async () => {
  const { seen, fetchFn } = fakeFetch(() => new Response('{"ok":true}', { status: 200 }));
  const answer = await callDaemon(sites, origin, { method: "POST", path: "/threads", body: '{"a":1}' }, fetchFn);
  assert.deepEqual(answer, { status: 200, text: '{"ok":true}' });
  assert.equal(seen[0]!.url, "http://127.0.0.1:4321/threads");
  assert.equal(seen[0]!.init.method, "POST");
  assert.equal(seen[0]!.init.body, '{"a":1}');
  assert.deepEqual(seen[0]!.init.headers, { [brand.tokenHeader]: "secret", "content-type": "application/json" });
});

test("call keeps the query", async () => {
  const { seen, fetchFn } = fakeFetch(() => new Response("{}"));
  await callDaemon(sites, origin, { method: "GET", path: "/threads?state=open" }, fetchFn);
  assert.equal(seen[0]!.url, "http://127.0.0.1:4321/threads?state=open");
  assert.deepEqual(seen[0]!.init.headers, { [brand.tokenHeader]: "secret" });
});

test("call refuses a path that does not start with one slash (//evil.example/x and http://evil.example/x)", async () => {
  const { seen, fetchFn } = fakeFetch(() => new Response("{}"));
  for (const path of ["//evil.example/x", "http://evil.example/x", "/\\evil.example/x", "threads"]) {
    const answer = await callDaemon(sites, origin, { method: "GET", path }, fetchFn);
    assert.ok("error" in answer, `should refuse: ${path}`);
  }
  assert.equal(seen.length, 0);
});

test("call refuses a site that is off and a site that was never added", async () => {
  const { seen, fetchFn } = fakeFetch(() => new Response("{}"));
  const off = { [origin]: { ...sites[origin]!, on: false } };
  const words = { status: 403, text: '{"error":"forbidden_origin","message":"This site is not turned on in the extension"}' };
  assert.deepEqual(await callDaemon(off, origin, { method: "GET", path: "/threads" }, fetchFn), words);
  assert.deepEqual(await callDaemon(sites, "https://other.test", { method: "GET", path: "/threads" }, fetchFn), words);
  assert.equal(seen.length, 0);
});

test("call answers status and text, also for a 409", async () => {
  const { fetchFn } = fakeFetch(() => new Response('{"error":"conflict"}', { status: 409 }));
  assert.deepEqual(await callDaemon(sites, origin, { method: "POST", path: "/x", body: "{}" }, fetchFn), { status: 409, text: '{"error":"conflict"}' });
});

test("call answers Cannot reach the daemon when fetch throws", async () => {
  const { fetchFn } = fakeFetch(() => Promise.reject(new TypeError("failed")));
  assert.deepEqual(await callDaemon(sites, origin, { method: "GET", path: "/health" }, fetchFn), { error: "Cannot reach the daemon" });
});

test("the site is the tab's own address, a site field in the message is ignored", async () => {
  const { seen, fetchFn } = fakeFetch(() => new Response("{}"));
  const both = { ...sites, "https://evil.test": { daemon: "http://127.0.0.1:9", token: "evil", on: true } };
  const sender = { tab: { url: `${origin}/some/page?x=1` } };
  const message = { kind: "call", method: "GET", path: "/threads", site: "https://evil.test" };
  await answerMessage(both, sender, message, fetchFn);
  assert.equal(seen[0]!.url, "http://127.0.0.1:4321/threads");
  assert.equal(await answerMessage({ [origin]: { ...sites[origin]!, on: false }, "https://evil.test": both["https://evil.test"] }, sender, { ...message, kind: "is_on" }), false);
});

test("a screenshot is taken of the sender's window only for a site that is on", async () => {
  const windows: number[] = [];
  const capture = async (windowId: number) => (windows.push(windowId), "data:image/png;base64,AAAA");
  assert.deepEqual(await answerScreenshot(sites, { tab: { url: `${origin}/page`, windowId: 7 } }, capture), { dataUrl: "data:image/png;base64,AAAA" });
  assert.deepEqual(windows, [7]);
  const off = { [origin]: { ...sites[origin], on: false } };
  assert.ok("error" in (await answerScreenshot(off, { tab: { url: `${origin}/page`, windowId: 7 } }, capture)));
  assert.deepEqual(windows, [7], "no capture for a site that is off");
});

test("a refused capture comes back as an error line", async () => {
  const refuse = async () => { throw new Error("Cannot access contents of the page"); };
  assert.deepEqual(await answerScreenshot(sites, { tab: { url: origin + "/", windowId: 1 } }, refuse), { error: "Cannot access contents of the page" });
});
