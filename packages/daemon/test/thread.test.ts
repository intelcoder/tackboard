import { test } from "node:test";
import assert from "node:assert/strict";
import type { ElementRef } from "@app/shared";
import { Thread } from "../src/domain/thread.ts";
import { Branch, CommitSha, AgentName } from "../src/domain/value_objects.ts";
import { DomainError } from "../src/domain/errors.ts";

const MIN = 60_000;
const element: ElementRef = {
  selector: "main > button",
  tag: "button",
  text: "Buy",
  html: "<button>Buy</button>",
  rect: { x: 1, y: 2, w: 3, h: 4 },
  confidence: "text",
};

function open(over: { id?: string; n?: number; now?: number; seq?: number } = {}): Thread {
  return Thread.open({
    id: over.id ?? "t1",
    n: over.n ?? 1,
    branch: Branch.of("main"),
    commit: CommitSha.of("abc1234"),
    url: "http://localhost:3000/",
    viewport: { w: 1000, h: 800 },
    element,
    text: "make this blue",
    now: over.now ?? 1000,
    seq: over.seq ?? 1,
  });
}

function throwsCode(fn: () => unknown, code: string): void {
  assert.throws(fn, (e: unknown) => e instanceof DomainError && e.code === code);
}

test("open creates pending thread with one user message", () => {
  const t = open();
  const dto = t.toDto(1000);
  assert.equal(dto.status, "pending");
  assert.equal(dto.openedBy, "user");
  assert.equal(dto.unread, false);
  assert.equal(dto.discarded, false);
  assert.equal(dto.branch, "main");
  assert.equal(dto.commit, "abc1234");
  assert.equal(dto.messages.length, 1);
  assert.deepEqual(dto.messages[0], { id: "m1", author: "user", text: "make this blue", at: 1000, discarded: false });
  assert.equal(t.pullEvents()[0]?.type, "posted");
});

test("openByAgent creates a waiting unread thread owned by the agent", () => {
  const t = Thread.openByAgent({
    id: "t2", n: 2, branch: Branch.of("main"), commit: CommitSha.of("abc1234"),
    url: "http://localhost:3000/", element, agent: AgentName.of("claude"), text: "is this intended?", now: 5, seq: 9,
  });
  const dto = t.toDto(5);
  assert.equal(dto.status, "waiting");
  assert.equal(dto.unread, true);
  assert.equal(dto.openedBy, "agent");
  assert.equal(dto.agent, "claude");
  assert.equal(dto.messages[0]?.author, "claude");
});

test("claim moves pending to received and records agent", () => {
  const t = open();
  t.claim(AgentName.of("claude"), 2000);
  const dto = t.toDto(2000);
  assert.equal(dto.status, "received");
  assert.equal(dto.agent, "claude");
  assert.equal(dto.claimedAt, 2000);
});

test('claim on a non-pending thread throws DomainError "not_pending"', () => {
  const t = open();
  t.claim(AgentName.of("claude"), 2000);
  throwsCode(() => t.claim(AgentName.of("other"), 2001), "not_pending");
});

test("agent reply with ask moves to waiting", () => {
  const t = open();
  t.claim(AgentName.of("claude"), 2000);
  t.reply("claude", "which blue?", 2100, 2, { ask: true });
  const dto = t.toDto(2100);
  assert.equal(dto.status, "waiting");
  assert.equal(dto.unread, true);
  assert.equal(dto.messages[1]?.ask, true);
});

test("agent reply without ask keeps received", () => {
  const t = open();
  t.claim(AgentName.of("claude"), 2000);
  t.reply("claude", "done", 2100, 2);
  assert.equal(t.status, "received");
  assert.equal(t.toDto(2100).unread, true);
});

test("user reply moves any non-resolved thread to pending and clears agent", () => {
  const t = open();
  t.claim(AgentName.of("claude"), 2000);
  t.reply("claude", "which blue?", 2100, 2, { ask: true });
  t.reply("user", "navy", 2200, 3);
  assert.equal(t.status, "pending");
  assert.equal(t.agent, undefined);
  assert.equal(t.toDto(2200).claimedAt, undefined);
  t.claim(AgentName.of("claude"), 2300);
  t.reply("user", "actually teal", 2400, 4);
  assert.equal(t.status, "pending");
});

test('resolve by agent always throws "waiting_on_user"', () => {
  const t = open();
  t.claim(AgentName.of("claude"), 2000);
  t.reply("claude", "done", 2100, 2);
  t.pullEvents();
  throwsCode(() => t.resolve("agent"), "waiting_on_user");
  assert.equal(t.status, "received");
  assert.equal(t.pullEvents().length, 0);
  t.reply("claude", "which blue?", 2200, 3, { ask: true });
  throwsCode(() => t.resolve("agent"), "waiting_on_user");
  assert.equal(t.status, "waiting");
});

test("user may resolve a waiting thread", () => {
  const t = open();
  t.claim(AgentName.of("claude"), 2000);
  t.reply("claude", "which blue?", 2100, 2, { ask: true });
  t.resolve("user");
  assert.equal(t.status, "resolved");
});

test("resolve after reply succeeds", () => {
  const t = open();
  t.claim(AgentName.of("claude"), 2000);
  t.reply("claude", "done", 2100, 2);
  t.resolve("user");
  assert.equal(t.status, "resolved");
  assert.ok(t.pullEvents().some((e) => e.type === "resolved"));
});

test("reopen on resolved returns pending", () => {
  const t = open();
  t.resolve("user");
  t.reopen();
  assert.equal(t.status, "pending");
  throwsCode(() => t.reopen(), "invalid");
  t.reply("user", "again", 3000, 2);
  t.resolve("user");
  t.reply("user", "one more", 3100, 3);
  assert.equal(t.status, "pending");
});

test("stale claim: isStaleClaim(claimedAt + 30*60_000 + 1) is true, at exactly +30*60_000 is false", () => {
  const t = open();
  t.claim(AgentName.of("claude"), 10_000);
  assert.equal(t.isStaleClaim(10_000 + 30 * MIN), false);
  assert.equal(t.isStaleClaim(10_000 + 30 * MIN + 1), true);
  assert.equal(t.toDto(10_000 + 30 * MIN + 1).claimStale, true);
  assert.equal(t.requeueIfStale(10_000 + 30 * MIN + 1), true);
  assert.equal(t.status, "pending");
  assert.ok(t.pullEvents().some((e) => e.type === "requeued"));
});

test("discardAfterSeq marks later messages discarded and leaves earlier ones", () => {
  const t = open({ seq: 1 });
  t.claim(AgentName.of("claude"), 2000);
  t.reply("claude", "a", 2100, 5);
  t.reply("claude", "b", 2200, 7);
  const ids = t.discardAfterSeq(5);
  assert.deepEqual(ids, ["m3"]);
  assert.deepEqual(t.messages.map((m) => m.discarded), [false, false, true]);
  assert.deepEqual(t.discardAfterSeq(5), []);
});

test("a thread whose first message is discarded reports discarded true", () => {
  const t = open({ seq: 10 });
  assert.equal(t.discarded, false);
  t.discardAfterSeq(3);
  assert.equal(t.discarded, true);
  assert.equal(t.toDto(1).discarded, true);
});

test("restoreBlocker names the claimed thread", () => {
  const a = open({ id: "a", n: 1 });
  const b = open({ id: "b", n: 7 });
  assert.equal(Thread.restoreBlocker([a, b], 5000), null);
  b.claim(AgentName.of("claude"), 5000);
  const reason = Thread.restoreBlocker([a, b], 5001);
  assert.ok(reason !== null && reason.includes("7"), String(reason));
  assert.equal(Thread.restoreBlocker([a, b], 5000 + 30 * MIN + 1), null);
});

test("claim records a claimed event holding the full ThreadDto snapshot", () => {
  const t = open();
  t.pullEvents();
  t.claim(AgentName.of("claude"), 2000);
  const events = t.pullEvents();
  assert.equal(events.length, 1);
  assert.equal(events[0]?.type, "claimed");
  assert.deepEqual(events[0]?.data, { thread: t.toDto(2000) });
  assert.deepEqual(t.pullEvents(), []);
});

test('Branch.of accepts "feature/pricing" and "HEAD"; AgentName.of rejects "", "user" and "system"', () => {
  assert.equal(Branch.of("feature/pricing").value, "feature/pricing");
  assert.equal(Branch.of("HEAD").value, "HEAD");
  assert.equal(Branch.of("no-git").value, "no-git");
  throwsCode(() => Branch.of(""), "invalid");
  assert.equal(AgentName.of("claude-1").value, "claude-1");
  for (const bad of ["", "user", "system"]) throwsCode(() => AgentName.of(bad), "invalid");
});
