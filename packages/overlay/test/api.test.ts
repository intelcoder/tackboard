import { test } from "node:test";
import assert from "node:assert/strict";
import { brand } from "@app/shared";
import type { ElementRef } from "@app/shared";
import { startStubDaemon } from "../../shared/test-support/stub_daemon.ts";
import { ApiError, createApi } from "../src/api.ts";

const element: ElementRef = {
  selector: "#cta",
  tag: "button",
  text: "Buy",
  html: "<button id=\"cta\">Buy</button>",
  rect: { x: 1, y: 2, w: 3, h: 4 },
  confidence: "text",
};
const body = (text: string) => ({ element, url: "http://localhost:3000/", viewport: { w: 800, h: 600 }, text });

test("post then list round trip through the typed client", async () => {
  const stub = await startStubDaemon();
  try {
    const api = createApi({ base: stub.url, token: stub.token });
    const t = await api.postThread(body("make it blue"));
    assert.equal(t.status, "pending");
    const list = await api.listThreads();
    assert.equal(list.branch, "main");
    assert.equal(list.threads.length, 1);
    assert.equal(list.threads[0]!.id, t.id);
    assert.equal(list.threads[0]!.messages[0]!.text, "make it blue");
  } finally {
    await stub.close();
  }
});

test("the token header is sent on every call", async () => {
  const stub = await startStubDaemon({ token: "tok-123" });
  try {
    const seen: (string | null)[] = [];
    const spy: typeof fetch = (input, init) => {
      seen.push(new Headers(init?.headers).get(brand.tokenHeader));
      return fetch(input, init);
    };
    const api = createApi({ base: stub.url, token: "tok-123", fetch: spy });
    const t = await api.postThread(body("hi"));
    await api.health();
    await api.listThreads({ state: "open" });
    await api.markRead(t.id);
    await api.history();
    await api.notices("claude-main");
    assert.equal(seen.length, 6);
    assert.ok(seen.every((v) => v === "tok-123"), JSON.stringify(seen));
  } finally {
    await stub.close();
  }
});

test("413 surfaces as ApiError with code too_large", async () => {
  const stub = await startStubDaemon();
  try {
    const api = createApi({ base: stub.url, token: stub.token });
    await assert.rejects(
      () => api.postThread(body("x".repeat(102401))),
      (e: unknown) => e instanceof ApiError && e.code === "too_large" && e.message.length > 0,
    );
  } finally {
    await stub.close();
  }
});
