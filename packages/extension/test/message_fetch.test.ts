import { test } from "node:test";
import assert from "node:assert/strict";
import { messageFetch } from "../src/message_fetch.ts";
import type { CallMessage } from "../src/proxy.ts";

test("a GET becomes a call with the path and query and no headers", async () => {
  const sent: CallMessage[] = [];
  const fetchFn = messageFetch(async (message) => {
    sent.push(message);
    return { status: 200, text: "{}" };
  });
  await fetchFn("/threads?state=open", { method: "GET", headers: { "x-token": "" } });
  assert.deepEqual(sent, [{ kind: "call", method: "GET", path: "/threads?state=open", body: undefined }]);
});

test("a POST sends its body", async () => {
  const sent: CallMessage[] = [];
  const fetchFn = messageFetch(async (message) => {
    sent.push(message);
    return { status: 200, text: "{}" };
  });
  await fetchFn("/threads", { method: "POST", body: '{"a":1}' });
  assert.equal(sent[0]!.body, '{"a":1}');
  assert.equal(sent[0]!.method, "POST");
});

test("a non-2xx answer becomes a Response that is not ok, with the text", async () => {
  const fetchFn = messageFetch(async () => ({ status: 409, text: '{"error":"conflict"}' }));
  const res = await fetchFn("/x", { method: "POST" });
  assert.equal(res.ok, false);
  assert.equal(res.status, 409);
  assert.equal(await res.text(), '{"error":"conflict"}');
  const broken = messageFetch(async () => ({ error: "Cannot reach the daemon" }));
  await assert.rejects(broken("/x", { method: "GET" }), { message: "Cannot reach the daemon" });
});

test("an abort rejects with AbortError", async () => {
  const fetchFn = messageFetch(() => new Promise(() => {}));
  const abort = new AbortController();
  const result = fetchFn("/x", { method: "GET", signal: abort.signal });
  abort.abort();
  await assert.rejects(result, { name: "AbortError" });
  await assert.rejects(fetchFn("/x", { method: "GET", signal: abort.signal }), { name: "AbortError" });
});
