import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ElementRef, ThreadDto } from "@app/shared";
import { SqliteThreadRepository } from "../src/infrastructure/sqlite_thread_repository.ts";
import { GitCheckpointStore } from "../src/infrastructure/git_checkpoint_store.ts";
import { GitInfoReader } from "../src/infrastructure/git_info.ts";
import type { CheckpointStore } from "../src/domain/checkpoint_store.ts";
import type { Clock } from "../src/domain/repositories.ts";
import { DomainError } from "../src/domain/errors.ts";
import { PostCommentHandler } from "../src/application/commands/post_comment.ts";
import { ClaimNextThreadHandler } from "../src/application/commands/claim_next_thread.ts";
import { ReplyToThreadHandler } from "../src/application/commands/reply_to_thread.ts";
import { ResolveThreadHandler } from "../src/application/commands/resolve_thread.ts";
import { ReleaseThreadHandler } from "../src/application/commands/release_thread.ts";
import { GetThreadHandler } from "../src/application/queries/get_thread.ts";
import { GetHistoryHandler } from "../src/application/queries/get_history.ts";
import { RestoreToMessageHandler } from "../src/application/commands/restore_to_message.ts";
import { AckNoticesHandler } from "../src/application/commands/ack_notices.ts";
import { GetNoticesHandler } from "../src/application/queries/get_notices.ts";

const MIN = 60_000;
const folders: string[] = [];
after(() => {
  for (const f of folders) rmSync(f, { recursive: true, force: true });
});

const git_env = {
  ...process.env,
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@example.com",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@example.com",
};

function git(dir: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: dir, env: git_env, encoding: "utf8" });
}

function write(dir: string, name: string, text: string): void {
  const full = join(dir, name);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, text);
}

function read(dir: string, name: string): string {
  return readFileSync(join(dir, name), "utf8");
}

function make_folder(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  folders.push(dir);
  return dir;
}

function make_repo(): string {
  const dir = make_folder("restore-");
  git(dir, "init", "-q", "-b", "main");
  write(dir, ".gitignore", "ignored.txt\n.tackboard/\n");
  write(dir, "a.txt", "a1\n");
  write(dir, "b.txt", "b1\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "first");
  return dir;
}

const element: ElementRef = {
  selector: "main > button", tag: "button", text: "Buy", html: "<button>Buy</button>",
  rect: { x: 1, y: 2, w: 3, h: 4 }, confidence: "text",
};

function post_args(text: string) {
  return { element, url: "http://localhost:3000/", viewport: { w: 1000, h: 800 }, text };
}

type Options = {
  dir?: string;
  wrap_store?: (real: CheckpointStore) => CheckpointStore;
  wrap_repo?: (real: SqliteThreadRepository) => SqliteThreadRepository;
};

function setup(options: Options = {}) {
  const dir = options.dir ?? make_repo();
  const db_folder = make_folder("restore-db-");
  const real_repo = new SqliteThreadRepository(join(db_folder, "db.sqlite"));
  const repo = options.wrap_repo ? options.wrap_repo(real_repo) : real_repo;
  const clock = { t: 1_000_000, now() { return this.t; } };
  const c: Clock = clock;
  const info = new GitInfoReader(dir);
  const real_store = new GitCheckpointStore(dir);
  const store = options.wrap_store ? options.wrap_store(real_store) : real_store;
  return {
    dir, repo, real_repo, clock, store, real_store,
    post: new PostCommentHandler(repo, c, info),
    claim: new ClaimNextThreadHandler(repo, c, info, store),
    reply: new ReplyToThreadHandler(repo, c, store),
    resolve: new ResolveThreadHandler(repo, c, store),
    release: new ReleaseThreadHandler(repo, c),
    get: new GetThreadHandler(repo, c),
    history: new GetHistoryHandler(repo),
    restore: new RestoreToMessageHandler(repo, c, info, store),
    notices: new GetNoticesHandler(repo, c),
    ack: new AckNoticesHandler(repo),
  };
}
type Setup = ReturnType<typeof setup>;

function messages(s: Setup, id: string) {
  return s.get.handle({ id }).messages;
}

/** Post a comment, let `claude` claim it, edit a file, reply with `done` and resolve. Returns the thread. */
function worked_thread(s: Setup, text: string, edit: (dir: string) => void): ThreadDto {
  const posted = s.post.handle(post_args(text));
  s.clock.t += 1_000;
  s.claim.handle({ agent: "claude" });
  edit(s.dir);
  s.clock.t += 1_000;
  s.reply.handle({ id: posted.id, author: "claude", text: "done" });
  s.resolve.handle({ id: posted.id, by: "agent", agent: "claude" });
  return s.get.handle({ id: posted.id });
}

function expect_code(fn: () => unknown, code: string, pattern?: RegExp) {
  assert.throws(fn, (e: unknown) => {
    assert.ok(e instanceof DomainError, `expected a DomainError, got ${String(e)}`);
    assert.equal(e.code, code);
    if (pattern) assert.match(e.message, pattern);
    return true;
  });
}

test("claim creates a checkpoint on the claimed user message", () => {
  const s = setup();
  write(s.dir, "a.txt", "dirty before claim\n");
  const posted = s.post.handle(post_args("make it blue"));
  const claimed = s.claim.handle({ agent: "claude" })!;
  assert.equal(claimed.id, posted.id);
  const first = messages(s, posted.id)[0]!;
  assert.match(first.checkpointId ?? "", /^[0-9a-f]{40}$/);
  assert.equal(s.real_store.hasChangedSince(first.checkpointId!), false);
  // The checkpoint holds the dirty file as it was at claim time.
  write(s.dir, "a.txt", "agent edit\n");
  s.real_store.restore(first.checkpointId!);
  assert.equal(read(s.dir, "a.txt"), "dirty before claim\n");
});

test("claim in a folder that is not a git repository still works and makes no checkpoint", () => {
  const s = setup({ dir: make_folder("nogit-") });
  const posted = s.post.handle(post_args("hello"));
  const claimed = s.claim.handle({ agent: "claude" })!;
  assert.equal(claimed.status, "received");
  assert.equal(messages(s, posted.id)[0]!.checkpointId, undefined);
});

test("reply with no file change creates no checkpoint", () => {
  const s = setup();
  const posted = s.post.handle(post_args("question"));
  s.claim.handle({ agent: "claude" });
  s.clock.t += 1_000;
  s.reply.handle({ id: posted.id, author: "claude", text: "nothing to change" });
  const list = messages(s, posted.id);
  assert.equal(list.length, 2);
  assert.ok(list[0]!.checkpointId);
  assert.equal(list[1]!.checkpointId, undefined);
});

test("reply after a file edit creates one", () => {
  const s = setup();
  const thread = worked_thread(s, "edit please", (dir) => write(dir, "a.txt", "a2\n"));
  const list = thread.messages;
  assert.ok(list[0]!.checkpointId);
  assert.ok(list[1]!.checkpointId);
  assert.notEqual(list[0]!.checkpointId, list[1]!.checkpointId);
  assert.deepEqual(s.real_store.changedFiles(list[0]!.checkpointId!, list[1]!.checkpointId!), ["a.txt"]);
  // A second reply with no new edit adds nothing.
  s.reply.handle({ id: thread.id, author: "claude", text: "also fine" });
  assert.equal(messages(s, thread.id)[2]!.checkpointId, undefined);
});

test("resolve creates a checkpoint only when files changed since the last one and the last message has none", () => {
  const s = setup();
  const posted = s.post.handle(post_args("fix"));
  s.claim.handle({ agent: "claude" });
  s.reply.handle({ id: posted.id, author: "claude", text: "looking" });
  write(s.dir, "a.txt", "edited after reply\n");
  s.resolve.handle({ id: posted.id, by: "agent", agent: "claude" });
  const list = messages(s, posted.id);
  assert.equal(list[1]!.checkpointId !== undefined, true, "the last message got the checkpoint");
  assert.equal(s.real_store.hasChangedSince(list[1]!.checkpointId!), false);

  const other = s.post.handle(post_args("second"));
  s.claim.handle({ agent: "claude" });
  s.reply.handle({ id: other.id, author: "claude", text: "looking" });
  s.resolve.handle({ id: other.id, by: "agent", agent: "claude" });
  assert.equal(messages(s, other.id)[1]!.checkpointId, undefined, "no change, no checkpoint");
});

test("restore rewinds files, takes a safety checkpoint first, marks later messages discarded", () => {
  const s = setup();
  write(s.dir, "ignored.txt", "keep me\n");
  const thread = worked_thread(s, "first", (dir) => {
    write(dir, "a.txt", "a2\n");
    write(dir, "new.txt", "new\n");
    rmSync(join(dir, "b.txt"));
  });
  const target = thread.messages[0]!;
  // The user edits after the agent finished; restore must save that too.
  write(s.dir, "a.txt", "user edit after the agent\n");
  s.clock.t += 5_000;

  const result = s.restore.handle({ threadId: thread.id, messageId: target.id });

  assert.equal(read(s.dir, "a.txt"), "a1\n");
  assert.equal(read(s.dir, "b.txt"), "b1\n");
  assert.equal(existsSync(join(s.dir, "new.txt")), false);
  assert.equal(read(s.dir, "ignored.txt"), "keep me\n");
  assert.equal(result.restoredTo, target.id);
  assert.deepEqual(result.discardedMessageIds, [`${thread.id}/m2`]);
  assert.deepEqual(result.discardedThreadIds, []);
  assert.deepEqual([...result.changedFiles].sort(), ["a.txt", "b.txt", "new.txt"]);

  // The safety checkpoint holds the state from just before the restore, including the user's edit.
  s.real_store.restore(result.safetyCheckpointId);
  assert.equal(read(s.dir, "a.txt"), "user edit after the agent\n");
  assert.equal(existsSync(join(s.dir, "new.txt")), true);

  const after_list = messages(s, thread.id);
  assert.equal(after_list.length, 3);
  assert.equal(after_list[0]!.discarded, false);
  assert.equal(after_list[1]!.discarded, true);
  assert.equal(after_list[2]!.author, "system");
  assert.equal(after_list[2]!.text, `Restored to message ${target.id}`);
  assert.equal(after_list[2]!.checkpointId, result.safetyCheckpointId);
  assert.equal(after_list[2]!.discarded, false);

  const restored = s.history.handle({}).filter((e) => e.type === "restored");
  assert.equal(restored.length, 1, "exactly one restored event");
  assert.equal(restored[0]!.threadId, thread.id);
  assert.equal(restored[0]!.at, s.clock.t);
});

test("restore discards messages across threads that are later than the target", () => {
  const s = setup();
  const one = worked_thread(s, "one", (dir) => write(dir, "a.txt", "a2\n"));
  const two = worked_thread(s, "two", (dir) => write(dir, "b.txt", "b2\n"));
  const later = s.post.handle(post_args("posted but not claimed"));

  const result = s.restore.handle({ threadId: one.id, messageId: "m1" });

  assert.deepEqual(result.discardedThreadIds, [two.id, later.id]);
  assert.deepEqual(result.discardedMessageIds, [`${one.id}/m2`, `${two.id}/m1`, `${two.id}/m2`, `${later.id}/m1`]);
  assert.equal(s.get.handle({ id: two.id }).discarded, true);
  assert.equal(s.get.handle({ id: later.id }).discarded, true);
  assert.equal(s.get.handle({ id: one.id }).discarded, false);
  assert.equal(read(s.dir, "a.txt"), "a1\n");
  assert.equal(read(s.dir, "b.txt"), "b1\n");
});

test("restore throws restore_blocked while a thread is claimed, succeeds when the claim is stale", () => {
  const s = setup();
  const done = worked_thread(s, "done work", (dir) => write(dir, "a.txt", "a2\n"));
  const busy = s.post.handle(post_args("busy"));
  s.clock.t += 1_000;
  s.claim.handle({ agent: "codex" });
  write(s.dir, "a.txt", "mid-work edit\n");

  expect_code(() => s.restore.handle({ threadId: done.id, messageId: "m1" }), "restore_blocked", /claimed by codex/);
  assert.equal(read(s.dir, "a.txt"), "mid-work edit\n", "files untouched when blocked");
  assert.equal(messages(s, done.id)[1]!.discarded, false);
  assert.equal(s.history.handle({}).filter((e) => e.type === "restored").length, 0);
  assert.equal(s.notices.handle({ agent: "claude" }).length, 0);

  s.clock.t += 31 * MIN;
  const result = s.restore.handle({ threadId: done.id, messageId: "m1" });
  assert.equal(read(s.dir, "a.txt"), "a1\n");
  assert.deepEqual(result.discardedThreadIds, [busy.id]);
});

test("a thread waiting on the user does not block restore", () => {
  const s = setup();
  const done = worked_thread(s, "done work", (dir) => write(dir, "a.txt", "a2\n"));
  const asking = s.post.handle(post_args("needs an answer"));
  s.claim.handle({ agent: "claude" });
  s.reply.handle({ id: asking.id, author: "claude", text: "which blue?", ask: true });
  assert.equal(s.get.handle({ id: asking.id }).status, "waiting");

  const result = s.restore.handle({ threadId: done.id, messageId: "m1" });

  assert.equal(read(s.dir, "a.txt"), "a1\n");
  assert.deepEqual(result.discardedThreadIds, [asking.id]);
});

test("a released thread no longer blocks restore", () => {
  const s = setup();
  const done = worked_thread(s, "done work", (dir) => write(dir, "a.txt", "a2\n"));
  const busy = s.post.handle(post_args("busy"));
  s.claim.handle({ agent: "codex" });
  expect_code(() => s.restore.handle({ threadId: done.id, messageId: "m1" }), "restore_blocked");
  s.release.handle({ id: busy.id });
  s.restore.handle({ threadId: done.id, messageId: "m1" });
  assert.equal(read(s.dir, "a.txt"), "a1\n");
});

test("restore on the wrong branch throws wrong_branch", () => {
  const s = setup();
  const thread = worked_thread(s, "on main", (dir) => write(dir, "a.txt", "a2\n"));
  git(s.dir, "checkout", "-q", "-b", "feature/other");
  write(s.dir, "a.txt", "a3 on the other branch\n");
  expect_code(() => s.restore.handle({ threadId: thread.id, messageId: "m1" }), "wrong_branch", /main/);
  assert.equal(read(s.dir, "a.txt"), "a3 on the other branch\n");
  assert.equal(messages(s, thread.id)[1]!.discarded, false);
});

test("restore outside a git repository throws no_git with a clear message", () => {
  const s = setup({ dir: make_folder("nogit-") });
  const posted = s.post.handle(post_args("hello"));
  s.claim.handle({ agent: "claude" });
  s.reply.handle({ id: posted.id, author: "claude", text: "done" });
  expect_code(() => s.restore.handle({ threadId: posted.id, messageId: "m1" }), "no_git", /git/);
  assert.equal(messages(s, posted.id)[1]!.discarded, false);
});

test("restore refuses an unknown thread, an unknown message, a message without a checkpoint and a discarded message", () => {
  const s = setup();
  const thread = worked_thread(s, "one", (dir) => write(dir, "a.txt", "a2\n"));
  const plain = s.post.handle(post_args("never claimed"));
  expect_code(() => s.restore.handle({ threadId: "nope", messageId: "m1" }), "not_found");
  expect_code(() => s.restore.handle({ threadId: thread.id, messageId: "m99" }), "not_found");
  expect_code(() => s.restore.handle({ threadId: plain.id, messageId: "m1" }), "invalid", /checkpoint/);
  write(s.dir, "a.txt", "keep\n");
  s.restore.handle({ threadId: thread.id, messageId: "m1" });
  expect_code(() => s.restore.handle({ threadId: thread.id, messageId: "m2" }), "invalid", /discarded/);
  assert.equal(read(s.dir, "a.txt"), "a1\n");
});

test("restoring the safety checkpoint message brings the edits back", () => {
  const s = setup();
  const thread = worked_thread(s, "one", (dir) => {
    write(dir, "a.txt", "a2\n");
    write(dir, "new.txt", "new\n");
  });
  write(s.dir, "b.txt", "user edit\n");
  const first = s.restore.handle({ threadId: thread.id, messageId: "m1" });
  assert.equal(read(s.dir, "a.txt"), "a1\n");
  assert.equal(existsSync(join(s.dir, "new.txt")), false);

  s.clock.t += 1_000;
  const back = s.restore.handle({ threadId: thread.id, messageId: "m3" });

  assert.equal(read(s.dir, "a.txt"), "a2\n");
  assert.equal(read(s.dir, "new.txt"), "new\n");
  assert.equal(read(s.dir, "b.txt"), "user edit\n");
  assert.notEqual(back.safetyCheckpointId, first.safetyCheckpointId);
  assert.equal(s.history.handle({}).filter((e) => e.type === "restored").length, 2);
});

test("restore adds a notice that pendingFor(agent) returns until ack", () => {
  const s = setup();
  s.notices.handle({ agent: "claude" });
  s.clock.t += 1_000;
  const thread = worked_thread(s, "one", (dir) => write(dir, "a.txt", "a2\n"));
  s.clock.t += 1_000;
  s.restore.handle({ threadId: thread.id, messageId: "m1" });

  const first = s.notices.handle({ agent: "claude" });
  assert.equal(first.length, 1);
  assert.equal(first[0]!.restoredToMessage, `${thread.id}/m1`);
  assert.equal(first[0]!.at, s.clock.t);
  assert.deepEqual(first[0]!.files, ["a.txt"]);
  assert.equal(s.notices.handle({ agent: "claude" }).length, 1, "repeats until ack");
  assert.equal(s.notices.handle({ agent: "claude" }).length, 1);

  s.ack.handle({ agent: "claude" });
  assert.deepEqual(s.notices.handle({ agent: "claude" }), []);
});

test("discarded threads are listed in the notice", () => {
  const s = setup();
  s.notices.handle({ agent: "claude" });
  const one = worked_thread(s, "one", (dir) => write(dir, "a.txt", "a2\n"));
  const two = worked_thread(s, "two", (dir) => write(dir, "b.txt", "b2\n"));
  s.restore.handle({ threadId: one.id, messageId: "m1" });
  const [notice] = s.notices.handle({ agent: "claude" });
  assert.deepEqual(notice!.discardedThreads, [two.id]);
  assert.deepEqual([...notice!.files].sort(), ["a.txt", "b.txt"]);
});

test("an agent first seen after a restore does not get that notice", () => {
  const s = setup();
  const one = worked_thread(s, "one", (dir) => write(dir, "a.txt", "a2\n"));
  s.clock.t += 1_000;
  s.restore.handle({ threadId: one.id, messageId: "m1" });
  s.clock.t += 1_000;
  assert.deepEqual(s.notices.handle({ agent: "late-agent" }), []);
  assert.equal(s.notices.handle({ agent: "claude" }).length, 1, "claude was seen before the restore");
});

// ---- failures: data must stay consistent ----

function failing_store(real: CheckpointStore, fail: Partial<Record<keyof CheckpointStore, string>>, after_real = false): CheckpointStore {
  const wrap = <A extends unknown[], R>(name: keyof CheckpointStore, run: (...a: A) => R) => (...a: A): R => {
    const reason = fail[name];
    if (reason !== undefined && !after_real) throw new Error(reason);
    const out = run(...a);
    if (reason !== undefined) {
      delete fail[name]; // fails once, so the rollback that follows can work
      throw new Error(reason);
    }
    return out;
  };
  return {
    snapshot: wrap("snapshot", (label: string) => real.snapshot(label)),
    restore: wrap("restore", (id: string) => real.restore(id)),
    changedFiles: wrap("changedFiles", (a: string, b: string) => real.changedFiles(a, b)),
    hasChangedSince: wrap("hasChangedSince", (id: string) => real.hasChangedSince(id)),
  };
}

test("a snapshot failure at claim gives a clear error and leaves the thread pending", () => {
  const fail = { snapshot: "disk full" };
  const s = setup({ wrap_store: (real) => failing_store(real, fail) });
  const posted = s.post.handle(post_args("hello"));
  expect_code(() => s.claim.handle({ agent: "claude" }), "internal", /checkpoint.*disk full/);
  const after_fail = s.get.handle({ id: posted.id });
  assert.equal(after_fail.status, "pending", "the claim was undone");
  assert.equal(after_fail.agent, undefined);
  assert.equal(after_fail.messages.length, 1);
  assert.equal(after_fail.messages[0]!.checkpointId, undefined);
});

test("a checkpoint failure at reply or resolve saves nothing", () => {
  const fail: Partial<Record<keyof CheckpointStore, string>> = {};
  const s = setup({ wrap_store: (real) => failing_store(real, fail) });
  const posted = s.post.handle(post_args("hello"));
  s.claim.handle({ agent: "claude" });
  s.reply.handle({ id: posted.id, author: "claude", text: "looking" });
  const before = s.get.handle({ id: posted.id });

  fail.hasChangedSince = "cannot read the folder";
  expect_code(() => s.reply.handle({ id: posted.id, author: "claude", text: "x" }), "internal", /checkpoint.*cannot read/);
  expect_code(() => s.resolve.handle({ id: posted.id, by: "agent", agent: "claude" }), "internal", /checkpoint/);
  assert.deepEqual(s.get.handle({ id: posted.id }), before);

  delete fail.hasChangedSince;
  write(s.dir, "a.txt", "changed\n");
  fail.snapshot = "disk full";
  expect_code(() => s.reply.handle({ id: posted.id, author: "claude", text: "x" }), "internal", /disk full/);
  assert.deepEqual(s.get.handle({ id: posted.id }), before);
  assert.equal(s.history.handle({ threadId: posted.id }).filter((e) => e.type === "replied").length, 1, "only the first reply");
});

test("a real snapshot failure (an unreadable file) becomes a domain error and saves nothing", { skip: process.getuid?.() === 0 }, () => {
  const s = setup();
  const posted = s.post.handle(post_args("hello"));
  s.claim.handle({ agent: "claude" });
  s.reply.handle({ id: posted.id, author: "claude", text: "looking" });
  const before = s.get.handle({ id: posted.id });
  write(s.dir, "secret.txt", "hidden\n");
  chmodSync(join(s.dir, "secret.txt"), 0o000);
  try {
    expect_code(() => s.reply.handle({ id: posted.id, author: "claude", text: "done" }), "internal", /checkpoint/);
    assert.deepEqual(s.get.handle({ id: posted.id }), before);
    expect_code(() => s.resolve.handle({ id: posted.id, by: "agent", agent: "claude" }), "internal", /checkpoint/);
    assert.deepEqual(s.get.handle({ id: posted.id }), before);
  } finally {
    chmodSync(join(s.dir, "secret.txt"), 0o644);
  }
});

test("restore failing in the first snapshot changes nothing", () => {
  const fail: Partial<Record<keyof CheckpointStore, string>> = {};
  const s = setup({ wrap_store: (real) => failing_store(real, fail) });
  const thread = worked_thread(s, "one", (dir) => write(dir, "a.txt", "a2\n"));
  const before = s.get.handle({ id: thread.id });
  write(s.dir, "a.txt", "user\n");
  fail.snapshot = "disk full";
  expect_code(() => s.restore.handle({ threadId: thread.id, messageId: "m1" }), "internal", /disk full/);
  assert.equal(read(s.dir, "a.txt"), "user\n");
  assert.deepEqual(s.get.handle({ id: thread.id }), before);
  assert.equal(s.notices.handle({ agent: "claude" }).length, 0);
});

test("restore failing halfway puts the files back and leaves thread data, events and notices unchanged", () => {
  const fail: Partial<Record<keyof CheckpointStore, string>> = {};
  const s = setup({ wrap_store: (real) => failing_store(real, fail, true) });
  const thread = worked_thread(s, "one", (dir) => write(dir, "a.txt", "a2\n"));
  const later = s.post.handle(post_args("later thread"));
  s.notices.handle({ agent: "claude" });
  const before = [s.get.handle({ id: thread.id }), s.get.handle({ id: later.id })];
  const events_before = s.history.handle({});
  write(s.dir, "a.txt", "user edit\n");
  write(s.dir, "extra.txt", "extra\n");

  fail.restore = "write failed halfway"; // the real restore runs, then reports a failure
  expect_code(() => s.restore.handle({ threadId: thread.id, messageId: "m1" }), "internal", /restore.*write failed halfway/);

  assert.equal(read(s.dir, "a.txt"), "user edit\n", "the safety checkpoint was restored");
  assert.equal(read(s.dir, "extra.txt"), "extra\n");
  assert.deepEqual([s.get.handle({ id: thread.id }), s.get.handle({ id: later.id })], before);
  assert.deepEqual(s.history.handle({}), events_before);
  assert.deepEqual(s.notices.handle({ agent: "claude" }), []);

  // After the failure is gone, restore works normally.
  delete fail.restore;
  s.restore.handle({ threadId: thread.id, messageId: "m1" });
  assert.equal(read(s.dir, "a.txt"), "a1\n");
});

test("saving the restore result failing puts the files back and discards nothing", () => {
  let broken = false;
  const s = setup({
    wrap_repo: (real) => {
      const original = real.saveRestore.bind(real);
      real.saveRestore = (...args) => {
        if (broken) throw new Error("database is locked");
        return original(...args);
      };
      return real;
    },
  });
  const thread = worked_thread(s, "one", (dir) => write(dir, "a.txt", "a2\n"));
  s.notices.handle({ agent: "claude" });
  const before = s.get.handle({ id: thread.id });
  write(s.dir, "a.txt", "user edit\n");
  broken = true;
  expect_code(() => s.restore.handle({ threadId: thread.id, messageId: "m1" }), "internal", /database is locked/);
  assert.equal(read(s.dir, "a.txt"), "user edit\n");
  assert.deepEqual(s.get.handle({ id: thread.id }), before);
  assert.deepEqual(s.notices.handle({ agent: "claude" }), []);
});
