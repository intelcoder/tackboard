import { test } from "node:test";
import assert from "node:assert/strict";
import type { ElementRef, Notice } from "@app/shared";
import type { ThreadRepository } from "../src/domain/repositories.ts";
import { Thread } from "../src/domain/thread.ts";
import { AgentName, Branch, CommitSha } from "../src/domain/value_objects.ts";

export type RepoHarness = {
  repo: ThreadRepository;
  /** Closes and reopens the underlying store; the returned repo sees everything saved so far. */
  reopen(): ThreadRepository;
  close(): void;
};

const MIN = 60_000;
const element: ElementRef = {
  selector: "main > button", tag: "button", text: "Buy", html: "<button>Buy</button>",
  rect: { x: 1, y: 2, w: 3, h: 4 }, confidence: "text",
};

function open(repo: ThreadRepository, branch = "main", text = "make this blue", now = 1_000): Thread {
  const b = Branch.of(branch);
  return Thread.open({
    id: repo.nextId(), n: repo.nextNumber(b), branch: b, commit: CommitSha.of("abc1234"),
    url: "http://localhost:3000/", viewport: { w: 1000, h: 800 }, element, text, now, seq: repo.nextSeq(),
  });
}

export function runContract(label: string, makeRepo: () => RepoHarness): void {
  function withRepo(fn: (h: RepoHarness) => void) {
    return () => {
      const h = makeRepo();
      try { fn(h); } finally { h.close(); }
    };
  }

  test(`${label}: save then get round-trips every field including messages and discard flags`, withRepo((h) => {
    const t = open(h.repo, "main", "first", 1_000);
    t.claim(AgentName.of("claude"), 2_000);
    t.reply("claude", "which blue?", 3_000, h.repo.nextSeq(), { ask: true });
    t.reply("user", "navy", 4_000, h.repo.nextSeq());
    t.attachCheckpoint("m3", "cp-sha");
    t.reply("claude", "done", 5_000, h.repo.nextSeq());
    t.discardAfterSeq(t.toState().messages[1]!.seq);
    h.repo.save(t);

    const got = h.repo.get(t.id)!;
    assert.ok(got);
    assert.deepEqual(got.toState(), t.toState());
    assert.deepEqual(got.toDto(9_000), t.toDto(9_000));
    assert.equal(got.messages.filter((m) => m.discarded).length, 2);
    assert.equal(got.messages.find((m) => m.id === "m2")?.ask, true);
    assert.equal(h.repo.get("nope"), null);

    const agentThread = Thread.openByAgent({
      id: h.repo.nextId(), n: h.repo.nextNumber(Branch.of("main")), branch: Branch.of("main"),
      commit: CommitSha.of("abc1234"), url: "http://x/", element, agent: AgentName.of("claude"),
      text: "question", now: 6_000, seq: h.repo.nextSeq(),
    });
    h.repo.save(agentThread);
    assert.deepEqual(h.repo.get(agentThread.id)!.toState(), agentThread.toState());
  }));

  test(`${label}: saving again keeps later discards and checkpoints`, withRepo((h) => {
    const t = open(h.repo, "main", "first");
    t.reply("claude", "done", 2_000, h.repo.nextSeq());
    h.repo.save(t);

    const loaded = h.repo.get(t.id)!;
    loaded.attachCheckpoint("m1", "cp-1");
    h.repo.save(loaded);
    assert.equal(h.repo.get(t.id)!.messages[0]!.checkpointId, "cp-1");
    assert.equal(h.repo.get(t.id)!.messages[1]!.discarded, false);

    const again = h.repo.get(t.id)!;
    again.discardAfterSeq(again.toState().messages[0]!.seq);
    again.addSystemMessage("restored", 3_000, h.repo.nextSeq(), "cp-2");
    h.repo.save(again);

    const back = h.repo.get(t.id)!;
    assert.deepEqual(back.toState(), again.toState());
    assert.equal(back.messages[1]!.discarded, true);
    assert.equal(back.messages[2]!.checkpointId, "cp-2");
    assert.equal(back.messages[0]!.checkpointId, "cp-1");
    assert.equal(back.messages.length, 3);
  }));

  test(`${label}: save is an upsert and does not duplicate messages`, withRepo((h) => {
    const t = open(h.repo);
    h.repo.save(t);
    t.reply("claude", "hi", 2_000, h.repo.nextSeq());
    h.repo.save(t);
    h.repo.save(t);
    assert.equal(h.repo.get(t.id)!.messages.length, 2);
    assert.equal(h.repo.listAll().length, 1);
  }));

  test(`${label}: claimNext is atomic: two calls in a row return different threads or null`, withRepo((h) => {
    const a = open(h.repo, "main", "a");
    const b = open(h.repo, "main", "b");
    h.repo.save(a);
    h.repo.save(b);
    const c1 = h.repo.claimNext(Branch.of("main"), AgentName.of("claude"), 10_000);
    const c2 = h.repo.claimNext(Branch.of("main"), AgentName.of("codex"), 10_000);
    const c3 = h.repo.claimNext(Branch.of("main"), AgentName.of("claude"), 10_000);
    assert.equal(c1?.id, a.id);
    assert.equal(c2?.id, b.id);
    assert.equal(c3, null);
    assert.equal(c1?.status, "received");
    assert.equal(c1?.agent, "claude");
    assert.equal(h.repo.get(a.id)!.status, "received");
    assert.equal(h.repo.get(b.id)!.agent, "codex");
  }));

  test(`${label}: claimNext skips discarded and other-branch threads and requeues stale claims first`, withRepo((h) => {
    const d = open(h.repo, "main", "discarded");
    d.discardAfterSeq(-1);
    h.repo.save(d);
    h.repo.save(open(h.repo, "other", "elsewhere"));
    assert.equal(h.repo.claimNext(Branch.of("main"), AgentName.of("claude"), 1_000), null);

    const t = open(h.repo, "main", "live");
    h.repo.save(t);
    assert.equal(h.repo.claimNext(Branch.of("main"), AgentName.of("claude"), 1_000)?.id, t.id);
    assert.equal(h.repo.claimNext(Branch.of("main"), AgentName.of("codex"), 1_000 + 5 * MIN), null);
    const again = h.repo.claimNext(Branch.of("main"), AgentName.of("codex"), 1_000 + 31 * MIN);
    assert.equal(again?.id, t.id);
    assert.equal(again?.agent, "codex");
    const types = h.repo.history(t.id).map((e) => e.type);
    assert.deepEqual(types, ["posted", "claimed", "requeued", "claimed"]);
  }));

  test(`${label}: data survives closing and reopening the db file`, withRepo((h) => {
    const t = open(h.repo, "main", "persist me");
    t.reply("claude", "ok", 2_000, h.repo.nextSeq());
    t.discardAfterSeq(-1);
    h.repo.save(t);
    const before = t.toState();
    const idBefore = h.repo.nextId();
    const reopened = h.reopen();
    assert.deepEqual(reopened.get(t.id)!.toState(), before);
    assert.equal(reopened.get(t.id)!.discarded, true);
    assert.equal(reopened.listByBranch(Branch.of("main")).length, 1);
    assert.notEqual(reopened.nextId(), idBefore, "id counter continues after reopen");
    assert.equal(reopened.nextNumber(Branch.of("main")), 2);
    const seqBefore = reopened.nextSeq();
    assert.ok(h.reopen().nextSeq() > seqBefore, "seq counter continues after reopen");
  }));

  test(`${label}: listByBranch isolates branches`, withRepo((h) => {
    const m1 = open(h.repo, "main");
    const f1 = open(h.repo, "feature/x");
    const m2 = open(h.repo, "main");
    for (const t of [m1, f1, m2]) h.repo.save(t);
    assert.deepEqual(h.repo.listByBranch(Branch.of("main")).map((t) => t.id), [m1.id, m2.id]);
    assert.deepEqual(h.repo.listByBranch(Branch.of("feature/x")).map((t) => t.id), [f1.id]);
    assert.deepEqual(h.repo.listByBranch(Branch.of("none")), []);
    assert.equal(h.repo.listAll().length, 3);
  }));

  test(`${label}: nextNumber is per branch and monotonic`, withRepo((h) => {
    const main = Branch.of("main");
    const feat = Branch.of("feature/x");
    assert.deepEqual([h.repo.nextNumber(main), h.repo.nextNumber(main), h.repo.nextNumber(feat), h.repo.nextNumber(main)], [1, 2, 1, 3]);
    const s1 = h.repo.nextSeq();
    const s2 = h.repo.nextSeq();
    assert.ok(s2 > s1);
    assert.notEqual(h.repo.nextId(), h.repo.nextId());
  }));

  test(`${label}: events are append-only and survive reopen`, withRepo((h) => {
    const t = open(h.repo);
    h.repo.save(t);
    t.claim(AgentName.of("claude"), 2_000);
    h.repo.save(t);
    t.resolve("user", 3_000);
    h.repo.save(t);
    h.repo.save(t);
    const other = open(h.repo, "main", "other");
    h.repo.save(other);

    const all = h.repo.history();
    assert.deepEqual(all.map((e) => e.type), ["posted", "claimed", "resolved", "posted"]);
    assert.deepEqual(all.map((e) => e.seq), [...all.map((e) => e.seq)].sort((a, b) => a - b));
    assert.equal(new Set(all.map((e) => e.seq)).size, 4);
    assert.deepEqual(h.repo.history(t.id).map((e) => e.type), ["posted", "claimed", "resolved"]);
    const claimed = all[1]!;
    assert.equal((claimed.data as { thread: { status: string } }).thread.status, "received");

    const reopened = h.reopen();
    assert.deepEqual(reopened.history(), all);
    reopened.save(reopened.get(t.id)!);
    assert.deepEqual(reopened.history(), all);
  }));

  test(`${label}: touchAgent and lastAgent report online within 60 s and offline after`, withRepo((h) => {
    assert.deepEqual(h.repo.lastAgent(0), { name: null, online: false });
    h.repo.touchAgent("claude", 100_000);
    assert.deepEqual(h.repo.lastAgent(100_000 + 59_000), { name: "claude", online: true });
    assert.deepEqual(h.repo.lastAgent(100_000 + 61_000), { name: "claude", online: false });
    h.repo.touchAgent("codex", 200_000);
    assert.equal(h.repo.lastAgent(200_000).name, "codex");
    assert.equal(h.reopen().lastAgent(200_000).name, "codex");
  }));
  const notice = (id: string, at: number, files: string[] = ["a.txt"]): Notice => ({
    id, at, restoredToMessage: "t1/m1", files, discardedThreads: ["t2"],
  });

  test(`${label}: notices survive reopen and ack is per agent`, withRepo((h) => {
    h.repo.touchAgent("claude", 1_000);
    h.repo.touchAgent("codex", 1_000);
    h.repo.saveRestore([], notice("n1", 2_000));
    assert.deepEqual(h.repo.pendingFor("claude"), [notice("n1", 2_000)]);
    assert.deepEqual(h.repo.pendingFor("codex"), [notice("n1", 2_000)]);

    h.repo.ack("claude");
    assert.deepEqual(h.repo.pendingFor("claude"), []);
    assert.equal(h.repo.pendingFor("codex").length, 1, "another agent still has it");

    h.repo.saveRestore([], notice("n2", 3_000, ["b.txt"]));
    assert.deepEqual(h.repo.pendingFor("claude").map((n) => n.id), ["n2"], "a new notice is pending again after ack");
    assert.deepEqual(h.repo.pendingFor("codex").map((n) => n.id), ["n1", "n2"]);

    const back = h.reopen();
    assert.deepEqual(back.pendingFor("claude").map((n) => n.id), ["n2"]);
    assert.deepEqual(back.pendingFor("codex").map((n) => n.id), ["n1", "n2"]);
    assert.deepEqual(back.pendingFor("codex")[1], notice("n2", 3_000, ["b.txt"]));
  }));

  test(`${label}: an agent first seen after a notice does not get it, and first_seen is set once`, withRepo((h) => {
    h.repo.saveRestore([], notice("old", 2_000));
    assert.deepEqual(h.repo.pendingFor("newcomer"), [], "unknown agent has no notices");
    h.repo.touchAgent("newcomer", 5_000);
    assert.deepEqual(h.repo.pendingFor("newcomer"), []);
    h.repo.saveRestore([], notice("later", 6_000));
    h.repo.touchAgent("newcomer", 9_000);
    assert.deepEqual(h.repo.pendingFor("newcomer").map((n) => n.id), ["later"], "touching again keeps the first time");
    assert.deepEqual(h.reopen().pendingFor("newcomer").map((n) => n.id), ["later"]);
  }));

  test(`${label}: saveRestore saves every thread and the notice together, or nothing`, withRepo((h) => {
    const a = open(h.repo, "main", "a");
    const b = open(h.repo, "main", "b");
    h.repo.save(a);
    h.repo.save(b);
    h.repo.touchAgent("claude", 1);
    h.repo.saveRestore([], notice("n1", 2_000));

    const a2 = h.repo.get(a.id)!;
    const b2 = h.repo.get(b.id)!;
    a2.discardAfterSeq(-1);
    b2.discardAfterSeq(-1);
    assert.throws(() => h.repo.saveRestore([a2, b2], notice("n1", 3_000)), "repeated notice id is refused");
    const same = h.reopen();
    assert.equal(same.get(a.id)!.discarded, false, "nothing was saved");
    assert.equal(same.get(b.id)!.discarded, false);
    assert.deepEqual(same.pendingFor("claude").map((n) => n.id), ["n1"]);

    same.saveRestore([a2, b2], notice("n2", 3_000));
    const after = h.reopen();
    assert.equal(after.get(a.id)!.discarded, true);
    assert.equal(after.get(b.id)!.discarded, true);
    assert.deepEqual(after.pendingFor("claude").map((n) => n.id), ["n1", "n2"]);
  }));
}
