import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { ElementRef } from "@app/shared";
import { InMemoryThreadRepository } from "./in_memory_repo.ts";
import { runContract } from "./thread_repository.contract.ts";
import { SqliteThreadRepository } from "../src/infrastructure/sqlite_thread_repository.ts";
import { SystemClock } from "../src/infrastructure/clock.ts";
import { Thread } from "../src/domain/thread.ts";
import { AgentName, Branch, CommitSha } from "../src/domain/value_objects.ts";

runContract("in-memory", () => {
  const repo = new InMemoryThreadRepository();
  return { repo, reopen: () => repo, close: () => {} };
});

runContract("sqlite", () => {
  const dir = mkdtempSync(join(tmpdir(), "tb-sqlite-"));
  const file = join(dir, "db.sqlite");
  let current = new SqliteThreadRepository(file);
  return {
    get repo() { return current; },
    reopen() { current.close(); current = new SqliteThreadRepository(file); return current; },
    close() { current.close(); rmSync(dir, { recursive: true, force: true }); },
  };
});

const element: ElementRef = {
  selector: "a", tag: "a", text: "t", html: "<a>t</a>", rect: { x: 0, y: 0, w: 1, h: 1 }, confidence: "text",
};

function fresh(): Thread {
  return Thread.open({
    id: "t1", n: 1, branch: Branch.of("main"), commit: CommitSha.of("abc1234"), url: "http://x/",
    viewport: { w: 1, h: 2 }, element, text: "hello", now: 10, seq: 1,
  });
}

test("Thread.toState/fromState round-trips, records no events and re-runs no invariants", () => {
  const t = fresh();
  t.claim(AgentName.of("claude"), 20);
  t.reply("claude", "q?", 30, 2, { ask: true });
  t.attachCheckpoint("m1", "cp");
  const state = t.toState();
  const back = Thread.fromState(state);
  assert.deepEqual(back.toState(), state);
  assert.deepEqual(back.toDto(99), t.toDto(99));
  assert.deepEqual(back.pullEvents(), [], "rehydration records no events");
  // an inconsistent state (resolved with an agent and a claim) is accepted as-is: no invariants re-run
  const odd = Thread.fromState({ ...state, status: "resolved", messages: [] });
  assert.equal(odd.status, "resolved");
  assert.equal(odd.messages.length, 0);
  // the state is a copy: mutating the source does not leak into the thread
  state.messages[0]!.text = "mutated";
  assert.equal(back.messages[0]!.text, "hello");
  // seq survives so discardAfterSeq works on a rehydrated thread
  assert.deepEqual(Thread.fromState(t.toState()).discardAfterSeq(1), ["m2"]);
});

test("two connections to one file never hand the same thread to both claimers", () => {
  const dir = mkdtempSync(join(tmpdir(), "tb-sqlite-"));
  const file = join(dir, "db.sqlite");
  const a = new SqliteThreadRepository(file);
  const b = new SqliteThreadRepository(file);
  try {
    a.save(fresh());
    const first = a.claimNext(Branch.of("main"), AgentName.of("one"), 100);
    const second = b.claimNext(Branch.of("main"), AgentName.of("two"), 100);
    assert.equal(first?.id, "t1");
    assert.equal(second, null);
    assert.equal(b.get("t1")!.agent, "one");
  } finally {
    a.close(); b.close(); rmSync(dir, { recursive: true, force: true });
  }
});

test("claimNext takes the write lock up front (BEGIN IMMEDIATE): a competing writer makes it fail fast", () => {
  const dir = mkdtempSync(join(tmpdir(), "tb-sqlite-"));
  const file = join(dir, "db.sqlite");
  const repo = new SqliteThreadRepository(file, { busyTimeoutMs: 0 });
  const rival = new DatabaseSync(file);
  try {
    repo.save(fresh());
    rival.exec("BEGIN IMMEDIATE");
    assert.throws(() => repo.claimNext(Branch.of("main"), AgentName.of("one"), 100), /locked|busy/i);
    rival.exec("ROLLBACK");
    assert.equal(repo.claimNext(Branch.of("main"), AgentName.of("one"), 100)?.id, "t1");
  } finally {
    rival.close(); repo.close(); rmSync(dir, { recursive: true, force: true });
  }
});

test("claimNext and save start with BEGIN IMMEDIATE, before any read", () => {
  const dir = mkdtempSync(join(tmpdir(), "tb-sqlite-"));
  const repo = new SqliteThreadRepository(join(dir, "db.sqlite"));
  try {
    const db = (repo as unknown as { db: DatabaseSync }).db;
    const seen: string[] = [];
    const exec = db.exec.bind(db);
    const prepare = db.prepare.bind(db);
    db.exec = (sql: string) => { seen.push(sql); return exec(sql); };
    db.prepare = (sql: string) => { seen.push(sql); return prepare(sql); };

    repo.claimNext(Branch.of("main"), AgentName.of("one"), 100);
    assert.equal(seen[0], "BEGIN IMMEDIATE");
    seen.length = 0;
    repo.save(fresh());
    assert.equal(seen[0], "BEGIN IMMEDIATE");
  } finally {
    repo.close(); rmSync(dir, { recursive: true, force: true });
  }
});

test("Thread.toState returns a copy: changing it does not change the thread", () => {
  const t = fresh();
  const state = t.toState();
  state.messages[0]!.text = "changed";
  state.messages.push({ id: "m9", author: "x", text: "x", at: 1, discarded: false, seq: 9 });
  state.element.tag = "span";
  state.viewport.w = 999;
  assert.equal(t.messages[0]!.text, "hello");
  assert.equal(t.messages.length, 1);
  assert.equal(t.element.tag, "a");
  assert.equal(t.viewport.w, 1);
});

test("SystemClock returns current epoch milliseconds", () => {
  const before = Date.now();
  const n = new SystemClock().now();
  assert.ok(n >= before && n <= Date.now());
});
