import test from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { LIMITS } from "@app/shared";
import { askRecorder, installRecorder } from "../src/page_errors.ts";

// A page with what the recorder touches: console, fetch, XHR, events.
function page(fetchImpl: (input: unknown, init?: unknown) => Promise<{ status: number }>) {
  const { window, document } = parseHTML("<html><body></body></html>");
  const w = window as any;
  const reached: unknown[][] = [];
  w.console = { error: (...a: unknown[]) => reached.push(a), warn() {}, log() {} };
  w.fetch = fetchImpl;
  w.XMLHttpRequest = function () {} as any;
  w.XMLHttpRequest.prototype.open = () => {};
  w.location = new URL("http://localhost:3000/app");
  w.CustomEvent = class extends Event { detail: unknown; constructor(type: string, init?: { detail?: unknown }) { super(type); this.detail = init?.detail; } };
  globalThis.CustomEvent = w.CustomEvent;
  globalThis.Request = class {} as any;
  installRecorder(w);
  return { w, reached, document: document as unknown as Document };
}

test("console.error and console.warn are recorded and still reach the console", () => {
  const { w, reached, document } = page(async () => ({ status: 200 }));
  w.console.error("boom", { a: 1 });
  w.console.warn("careful");
  w.console.log("not recorded");
  assert.deepEqual(reached, [["boom", { a: 1 }]]);
  assert.deepEqual(askRecorder(document), [
    { kind: "error", text: 'boom {"a":1}' },
    { kind: "warn", text: "careful" },
  ]);
});

test("a failed or 4xx/5xx fetch is recorded by path only; a 200 is not", async () => {
  const { w, document } = page(async (input) => {
    if (String(input).includes("down")) throw new TypeError("Failed to fetch");
    return { status: String(input).includes("bad") ? 500 : 200 };
  });
  await w.fetch("/api/ok?token=secret");
  await w.fetch("/api/bad?token=secret", { method: "post" });
  await w.fetch("https://other.test/down?x=1").catch(() => {});
  assert.deepEqual(askRecorder(document), [
    { kind: "network", text: "POST /api/bad 500" },
    { kind: "network", text: "GET other.test/down failed: TypeError: Failed to fetch" },
  ]);
});

test("only the newest lines are kept and each is cut short", () => {
  const { w, document } = page(async () => ({ status: 200 }));
  for (let i = 0; i < LIMITS.pageErrors + 5; i++) w.console.error(`e${i} ${"x".repeat(1000)}`);
  const got = askRecorder(document)!;
  assert.equal(got.length, LIMITS.pageErrors);
  assert.ok(got[0]!.text.startsWith("e5 "));
  assert.equal(got[0]!.text.length, LIMITS.pageErrorText);
});

test("with no recorder on the page the answer is null", () => {
  const { document } = parseHTML("<html></html>");
  assert.equal(askRecorder(document as unknown as Document), null);
});
