import { test } from "node:test";
import assert from "node:assert/strict";
import { agentState, statusLabel } from "../src/status.ts";
import type { ThreadStatus } from "../src/types.ts";

test("statusLabel covers every ThreadStatus", () => {
  const all: ThreadStatus[] = ["pending", "received", "waiting", "resolved"];
  assert.deepEqual(all.map(statusLabel), ["pending", "received", "waiting on you", "resolved"]);
  assert.equal(statusLabel("discarded"), "discarded");
  for (const s of [...all, "discarded" as const]) assert.notEqual(statusLabel(s), "");
});

test("agentState: listening, idle, away, none", () => {
  const at = 1_000_000;
  const s = (ago: number | null) => agentState({ name: "claude-code", seenAt: ago === null ? null : at - ago }, at, "tb");
  assert.equal(s(null).kind, "none");
  assert.match(s(null).hint, /`tb wait`/);
  assert.equal(s(2_000).kind, "listening");
  assert.equal(s(45_000).kind, "idle");
  assert.equal(s(45_000).label, "idle · 45 s");
  assert.equal(s(5 * 60_000).label, "idle · 5 min");
  assert.equal(s(30 * 60_000).kind, "away");
  assert.equal(s(3 * 3600_000).label, "away · 3 h");
  assert.equal(agentState({ name: "x", seenAt: at + 5000 }, at, "tb").kind, "listening", "a clock a little behind is not negative");
});
