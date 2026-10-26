import { test } from "node:test";
import assert from "node:assert/strict";
import { statusLabel } from "../src/status.ts";
import type { ThreadStatus } from "../src/types.ts";

test("statusLabel covers every ThreadStatus", () => {
  const all: ThreadStatus[] = ["pending", "received", "waiting", "resolved"];
  assert.deepEqual(all.map(statusLabel), ["pending", "received", "waiting on you", "resolved"]);
  assert.equal(statusLabel("discarded"), "discarded");
  for (const s of [...all, "discarded" as const]) assert.notEqual(statusLabel(s), "");
});
