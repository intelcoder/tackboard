import { test } from "node:test";
import assert from "node:assert/strict";
import type { ElementRef } from "@app/shared";
import { InMemoryThreadRepository } from "./in_memory_repo.ts";
import type { CheckpointStore } from "../src/domain/checkpoint_store.ts";
import type { Clock, GitInfo } from "../src/domain/repositories.ts";
import { Branch, CommitSha } from "../src/domain/value_objects.ts";
import { DomainError } from "../src/domain/errors.ts";
import { PostCommentHandler } from "../src/application/commands/post_comment.ts";
import { PostAgentCommentHandler } from "../src/application/commands/post_agent_comment.ts";
import { ClaimNextThreadHandler } from "../src/application/commands/claim_next_thread.ts";
import { ReplyToThreadHandler } from "../src/application/commands/reply_to_thread.ts";
import { ResolveThreadHandler } from "../src/application/commands/resolve_thread.ts";
import { ReopenThreadHandler } from "../src/application/commands/reopen_thread.ts";
import { ReleaseThreadHandler } from "../src/application/commands/release_thread.ts";
import { MarkReadHandler } from "../src/application/commands/mark_read.ts";
import { GetThreadHandler } from "../src/application/queries/get_thread.ts";
import { ListThreadsHandler } from "../src/application/queries/list_threads.ts";
import { GetHistoryHandler } from "../src/application/queries/get_history.ts";

const MIN = 60_000;

/** A checkpoint store for a project without git: every call says no_git, so handlers make no checkpoints. */
const noCheckpoints: CheckpointStore = {
  snapshot() { throw new DomainError("no_git", "not a git repository"); },
  restore() { throw new DomainError("no_git", "not a git repository"); },
  changedFiles() { throw new DomainError("no_git", "not a git repository"); },
  hasChangedSince() { throw new DomainError("no_git", "not a git repository"); },
};
const element: ElementRef = {
  selector: "main > button", tag: "button", text: "Buy", html: "<button>Buy</button>",
  rect: { x: 1, y: 2, w: 3, h: 4 }, confidence: "text",
};

function setup() {
  const repo = new InMemoryThreadRepository();
  const clock = { t: 1_000_000, now() { return this.t; } };
  const git = {
    current: "main",
    existing: ["main", "feature/x"],
    branch() { return Branch.of(this.current); },
    commit() { return CommitSha.of("abc1234"); },
    branches() { return this.existing; },
  };
  const c: Clock = clock;
  const g: GitInfo = git;
  return {
    repo, clock, git,
    post: new PostCommentHandler(repo, c, g),
    postAgent: new PostAgentCommentHandler(repo, c, g),
    claim: new ClaimNextThreadHandler(repo, c, g, noCheckpoints),
    reply: new ReplyToThreadHandler(repo, c, noCheckpoints),
    resolve: new ResolveThreadHandler(repo, c, noCheckpoints),
    reopen: new ReopenThreadHandler(repo, c),
    release: new ReleaseThreadHandler(repo, c),
    markRead: new MarkReadHandler(repo, c),
    get: new GetThreadHandler(repo, c),
    list: new ListThreadsHandler(repo, c, g),
    history: new GetHistoryHandler(repo),
  };
}

function postArgs(text = "make this blue", el: ElementRef = element) {
  return { element: el, url: "http://localhost:3000/", viewport: { w: 1000, h: 800 }, text };
}

test("post then claim returns the thread and a second claim returns null", () => {
  const s = setup();
  const posted = s.post.handle(postArgs());
  const first = s.claim.handle({ agent: "claude" });
  assert.equal(first?.id, posted.id);
  assert.equal(first?.status, "received");
  assert.equal(first?.agent, "claude");
  assert.equal(s.claim.handle({ agent: "claude" }), null);
});

test("claims oldest first across three posts", () => {
  const s = setup();
  const a = s.post.handle(postArgs("a"));
  s.clock.t += 10;
  const b = s.post.handle(postArgs("b"));
  s.clock.t += 10;
  const c = s.post.handle(postArgs("c"));
  assert.deepEqual(
    [s.claim.handle({ agent: "x" })?.id, s.claim.handle({ agent: "x" })?.id, s.claim.handle({ agent: "x" })?.id],
    [a.id, b.id, c.id],
  );
});

test("stale claim is re-queued before claiming", () => {
  const s = setup();
  const posted = s.post.handle(postArgs());
  s.claim.handle({ agent: "one" });
  assert.equal(s.claim.handle({ agent: "two" }), null);
  s.clock.t += 30 * MIN + 1;
  const again = s.claim.handle({ agent: "two" });
  assert.equal(again?.id, posted.id);
  assert.equal(again?.agent, "two");
  const types = s.history.handle({ threadId: posted.id }).map((e) => e.type);
  assert.deepEqual(types, ["posted", "claimed", "requeued", "claimed"]);
});

test("reply with ask then user reply returns thread to pending and next claim returns it again", () => {
  const s = setup();
  const posted = s.post.handle(postArgs());
  s.claim.handle({ agent: "claude" });
  const asked = s.reply.handle({ id: posted.id, author: "claude", text: "which blue?", ask: true });
  assert.equal(asked.status, "waiting");
  assert.equal(s.claim.handle({ agent: "claude" }), null);
  const answered = s.reply.handle({ id: posted.id, author: "user", text: "navy" });
  assert.equal(answered.status, "pending");
  const again = s.claim.handle({ agent: "claude" });
  assert.equal(again?.id, posted.id);
  assert.deepEqual(again?.messages.map((m) => m.text), ["make this blue", "which blue?", "navy"]);
});

test("list filters by branch", () => {
  const s = setup();
  s.post.handle(postArgs("on main"));
  s.git.current = "feature/x";
  s.post.handle(postArgs("on feature"));
  const onFeature = s.list.handle({});
  assert.equal(onFeature.branch, "feature/x");
  assert.deepEqual(onFeature.threads.map((t) => t.messages[0]!.text), ["on feature"]);
  const onMain = s.list.handle({ branch: "main" });
  assert.deepEqual(onMain.threads.map((t) => t.messages[0]!.text), ["on main"]);
  const claimed = s.claim.handle({ agent: "a", branch: "main" });
  assert.equal(claimed?.messages[0]!.text, "on main");
});

test("discarded threads are not claimable and sit in history", () => {
  const s = setup();
  const posted = s.post.handle(postArgs());
  const t = s.repo.get(posted.id)!;
  t.discardAfterSeq(0);
  s.repo.save(t);
  assert.equal(s.claim.handle({ agent: "claude" }), null);
  const res = s.list.handle({});
  assert.deepEqual(res.threads, []);
  assert.deepEqual(res.history.map((h) => h.id), [posted.id]);
});

test("threads of a deleted branch are in history, HEAD and no-git are never archived", () => {
  const s = setup();
  for (const b of ["old-branch", "HEAD", "no-git", "main"]) {
    s.git.current = b;
    s.post.handle(postArgs(`on ${b}`));
  }
  s.git.current = "main";
  const res = s.list.handle({});
  assert.deepEqual(res.history.map((h) => h.branch), ["old-branch"]);
  assert.deepEqual(res.threads.map((h) => h.branch), ["main"]);
  const head = s.list.handle({ branch: "HEAD" });
  assert.deepEqual(head.threads.map((h) => h.branch), ["HEAD"]);
  assert.deepEqual(head.history.map((h) => h.branch), ["old-branch"]);
});

test("list carries restoreBlocked while a thread is claimed", () => {
  const s = setup();
  const posted = s.post.handle(postArgs());
  assert.equal(s.list.handle({}).restoreBlocked, null);
  s.claim.handle({ agent: "claude" });
  const blocked = s.list.handle({}).restoreBlocked;
  assert.ok(blocked && blocked.includes(`#${posted.n}`));
  s.clock.t += 30 * MIN + 1;
  assert.equal(s.list.handle({}).restoreBlocked, null);
});

test("agent comment creates a waiting unread thread", () => {
  const s = setup();
  const t = s.postAgent.handle({ agent: "claude", selector: "#hero", text: "is this intended?" });
  assert.equal(t.status, "waiting");
  assert.equal(t.unread, true);
  assert.equal(t.openedBy, "agent");
  assert.equal(t.element.selector, "#hero");
  assert.equal(t.element.confidence, "text");
  assert.equal(t.messages[0]!.author, "claude");
  assert.equal(s.list.handle({}).agent.name, "claude");
});

test("get history returns the claimed event with the thread snapshot", () => {
  const s = setup();
  const posted = s.post.handle(postArgs());
  const claimed = s.claim.handle({ agent: "claude" })!;
  s.reply.handle({ id: posted.id, author: "claude", text: "done" });
  const events = s.history.handle({ threadId: posted.id });
  const ev = events.find((e) => e.type === "claimed")!;
  assert.deepEqual((ev.data as { thread: unknown }).thread, claimed);
  assert.equal(events.some((e) => e.type === "replied"), true);
  assert.equal(s.history.handle({}).length, events.length);
});

test("post truncates html to 4096 and text to 120", () => {
  const s = setup();
  const t = s.post.handle(postArgs("hi", { ...element, html: "h".repeat(5000), text: "t".repeat(500) }));
  assert.equal(t.element.html.length, 4096);
  assert.equal(t.element.text.length, 120);
});

test("a user reply does not set unread", () => {
  const s = setup();
  const posted = s.post.handle(postArgs());
  s.claim.handle({ agent: "claude" });
  const after = s.reply.handle({ id: posted.id, author: "user", text: "more detail" });
  assert.equal(after.unread, false);
  assert.equal(s.get.handle({ id: posted.id }).unread, false);
});

test("an agent reply sets unread and mark read clears it", () => {
  const s = setup();
  const posted = s.post.handle(postArgs());
  s.claim.handle({ agent: "claude" });
  const after = s.reply.handle({ id: posted.id, author: "claude", text: "working" });
  assert.equal(after.unread, true);
  assert.equal(s.markRead.handle({ id: posted.id }).unread, false);
});

test("handlers stamp events with the injected clock", () => {
  const s = setup();
  const posted = s.post.handle(postArgs());
  s.clock.t = 5_000_000;
  s.claim.handle({ agent: "claude" });
  s.resolve.handle({ id: posted.id, by: "user" });
  s.clock.t = 6_000_000;
  s.reopen.handle({ id: posted.id });
  s.clock.t = 7_000_000;
  s.claim.handle({ agent: "claude" });
  s.clock.t = 8_000_000;
  s.release.handle({ id: posted.id });
  const at = s.history.handle({ threadId: posted.id }).map((e) => [e.type, e.at]);
  assert.deepEqual(at, [
    ["posted", 1_000_000], ["claimed", 5_000_000], ["resolved", 5_000_000],
    ["reopened", 6_000_000], ["claimed", 7_000_000], ["released", 8_000_000],
  ]);
});

test("history holds discarded threads of the queried branch only, not of other existing branches", () => {
  const s = setup();
  const discard = (id: string) => { const t = s.repo.get(id)!; t.discardAfterSeq(0); s.repo.save(t); };
  const onMain = s.post.handle(postArgs("main one"));
  s.git.current = "feature/x";
  const onFeature = s.post.handle(postArgs("feature one"));
  discard(onMain.id);
  discard(onFeature.id);
  assert.deepEqual(s.list.handle({ branch: "main" }).history.map((h) => h.id), [onMain.id]);
  assert.deepEqual(s.list.handle({ branch: "feature/x" }).history.map((h) => h.id), [onFeature.id]);
});

test("state open and resolved filter threads and leave history alone", () => {
  const s = setup();
  const a = s.post.handle(postArgs("a"));
  const b = s.post.handle(postArgs("b"));
  const gone = s.post.handle(postArgs("gone"));
  s.resolve.handle({ id: b.id, by: "user" });
  const g = s.repo.get(gone.id)!; g.discardAfterSeq(0); s.repo.save(g);
  const open = s.list.handle({ state: "open" });
  const resolved = s.list.handle({ state: "resolved" });
  assert.deepEqual(open.threads.map((t) => t.id), [a.id]);
  assert.deepEqual(resolved.threads.map((t) => t.id), [b.id]);
  assert.deepEqual(open.history.map((t) => t.id), [gone.id]);
  assert.deepEqual(resolved.history.map((t) => t.id), [gone.id]);
  assert.deepEqual(s.list.handle({}).threads.map((t) => t.id), [a.id, b.id]);
});

test("claim, reply and agent comment each register the agent as present", () => {
  const s = setup();
  const name = () => s.list.handle({}).agent;
  assert.deepEqual(name(), { name: null, online: false });
  const t1 = s.post.handle(postArgs("one"));
  s.post.handle(postArgs("two"));
  s.claim.handle({ agent: "claimer" });
  assert.deepEqual(name(), { name: "claimer", online: true });
  s.clock.t += 1000;
  s.reply.handle({ id: t1.id, author: "replier", text: "hi" });
  assert.deepEqual(name(), { name: "replier", online: true });
  s.clock.t += 1000;
  s.postAgent.handle({ agent: "poster", selector: "#a", text: "q" });
  assert.deepEqual(name(), { name: "poster", online: true });
});

test("agent online flips to false after 60 s of injected clock time", () => {
  const s = setup();
  s.claim.handle({ agent: "claude" });
  s.clock.t += 60_000;
  assert.equal(s.list.handle({}).agent.online, true);
  s.clock.t += 1;
  assert.deepEqual(s.list.handle({}).agent, { name: "claude", online: false });
});

test("message timestamps come from the injected clock", () => {
  const s = setup();
  const posted = s.post.handle(postArgs());
  assert.equal(posted.messages[0]!.at, 1_000_000);
  s.clock.t = 2_000_000;
  const replied = s.reply.handle({ id: posted.id, author: "claude", text: "x" });
  assert.equal(replied.messages[1]!.at, 2_000_000);
  s.clock.t = 3_000_000;
  const user = s.reply.handle({ id: posted.id, author: "user", text: "y" });
  assert.equal(user.messages[2]!.at, 3_000_000);
});

test("list restoreBlocked still names the claimed thread when the state filter hides it", () => {
  const s = setup();
  const done = s.post.handle(postArgs("done"));
  s.post.handle(postArgs("busy"));
  s.claim.handle({ agent: "claude" });
  s.resolve.handle({ id: done.id, by: "user" });
  s.claim.handle({ agent: "claude" });
  const resolvedOnly = s.list.handle({ state: "resolved" });
  assert.deepEqual(resolvedOnly.threads.map((t) => t.messages[0]!.text), ["done"]);
  assert.match(resolvedOnly.restoreBlocked ?? "", /claimed by claude/);
});
