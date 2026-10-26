import { test } from "node:test";
import assert from "node:assert/strict";
import { brand } from "../src/brand.ts";
import { paths } from "../src/api.ts";
import type { ElementRef, ThreadDto } from "../src/types.ts";

type Handle = { url: string; token: string; close(): Promise<void> };

const el: ElementRef = {
  selector: "main > button.buy",
  tag: "button",
  text: "Buy",
  html: "<button class=\"buy\">Buy</button>",
  rect: { x: 1, y: 2, w: 3, h: 4 },
  confidence: "text",
};

const THREAD_KEYS = [
  "id", "n", "branch", "commit", "url", "viewport", "element", "status",
  "openedBy", "unread", "discarded", "claimStale", "messages",
];

export function runApiContract(label: string, start: () => Promise<Handle>): void {
  async function withDaemon(fn: (api: Api) => Promise<void>): Promise<void> {
    const d = await start();
    const api: Api = {
      url: d.url,
      call: (method, path, body, token = d.token) =>
        fetch(d.url + path, {
          method,
          headers: { "content-type": "application/json", ...(token ? { [brand.tokenHeader]: token } : {}) },
          body: body === undefined ? undefined : JSON.stringify(body),
        }),
    };
    try {
      await fn(api);
    } finally {
      await d.close();
    }
  }
  type Api = {
    url: string;
    call(method: string, path: string, body?: unknown, token?: string | null): Promise<Response>;
  };
  const post = (api: Api, text = "hello") =>
    api.call("POST", paths.threads, { element: el, url: "http://localhost:3000/", viewport: { w: 800, h: 600 }, text });

  test(`contract (${label}): post then list round-trip`, () =>
    withDaemon(async (api) => {
      const r = await post(api);
      assert.equal(r.status, 201);
      const t = (await r.json()) as ThreadDto;
      for (const k of THREAD_KEYS) assert.ok(k in t, `missing key ${k}`);
      assert.equal(t.status, "pending");
      assert.equal(t.messages[0]!.author, "user");
      const list = await (await api.call("GET", paths.threads)).json();
      assert.equal(list.threads.length, 1);
      assert.equal(list.threads[0].id, t.id);
      for (const k of ["branch", "threads", "history", "agent", "restoreBlocked"]) assert.ok(k in list, k);
    }));

  test(`contract (${label}): claim-next returns oldest first then null`, () =>
    withDaemon(async (api) => {
      const a = (await (await post(api, "first")).json()) as ThreadDto;
      const b = (await (await post(api, "second")).json()) as ThreadDto;
      const c1 = await (await api.call("POST", paths.claimNext, { agent: "claude" })).json();
      const c2 = await (await api.call("POST", paths.claimNext, { agent: "claude" })).json();
      const c3 = await (await api.call("POST", paths.claimNext, { agent: "claude" })).json();
      assert.equal(c1.thread.id, a.id);
      assert.equal(c1.thread.status, "received");
      assert.equal(c2.thread.id, b.id);
      assert.equal(c3.thread, null);
    }));

  test(`contract (${label}): agent ask moves to waiting and user reply re-queues to pending`, () =>
    withDaemon(async (api) => {
      const t = (await (await post(api)).json()) as ThreadDto;
      await api.call("POST", paths.claimNext, { agent: "claude" });
      const asked = await (await api.call("POST", paths.messages(t.id), { author: "claude", text: "which one?", ask: true })).json();
      assert.equal(asked.status, "waiting");
      const replied = await (await api.call("POST", paths.messages(t.id), { author: "user", text: "this one" })).json();
      assert.equal(replied.status, "pending");
    }));

  test(`contract (${label}): resolve by agent is 409 waiting_on_user and the thread stays open`, () =>
    withDaemon(async (api) => {
      const t = (await (await post(api)).json()) as ThreadDto;
      await api.call("POST", paths.claimNext, { agent: "claude" });
      await api.call("POST", paths.messages(t.id), { author: "claude", text: "done" });
      for (const body of [{ by: "agent", agent: "claude" }, { by: "agent" }]) {
        const r = await api.call("POST", paths.resolve(t.id), body);
        assert.equal(r.status, 409);
        assert.equal((await r.json()).error, "waiting_on_user");
      }
      const list = (await (await api.call("GET", paths.threads)).json()) as { threads: ThreadDto[] };
      assert.equal(list.threads[0]!.status, "received");
    }));

  test(`contract (${label}): user may resolve a waiting thread`, () =>
    withDaemon(async (api) => {
      const t = (await (await post(api)).json()) as ThreadDto;
      await api.call("POST", paths.claimNext, { agent: "claude" });
      await api.call("POST", paths.messages(t.id), { author: "claude", text: "?", ask: true });
      const r = await api.call("POST", paths.resolve(t.id), { by: "user" });
      assert.equal(r.status, 200);
      assert.equal((await r.json()).status, "resolved");
    }));

  test(`contract (${label}): missing token is 401 except health`, () =>
    withDaemon(async (api) => {
      const r = await api.call("GET", paths.threads, undefined, null);
      assert.equal(r.status, 401);
      assert.equal((await r.json()).error, "unauthorized");
      const h = await api.call("GET", paths.health, undefined, null);
      assert.equal(h.status, 200);
      assert.deepEqual(await h.json(), { ok: true });
    }));

  test(`contract (${label}): 150 KB text is 413 too_large and health still answers`, () =>
    withDaemon(async (api) => {
      const r = await post(api, "x".repeat(150 * 1024));
      assert.equal(r.status, 413);
      assert.equal((await r.json()).error, "too_large");
      assert.equal((await api.call("GET", paths.health)).status, 200);
    }));

  test(`contract (${label}): unknown thread is 404 not_found`, () =>
    withDaemon(async (api) => {
      const r = await api.call("POST", paths.messages("nope"), { author: "user", text: "hi" });
      assert.equal(r.status, 404);
      assert.equal((await r.json()).error, "not_found");
    }));
}
