import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { brand, LIMITS, paths } from "@app/shared";
import type { ElementRef, HistoryEvent, ListThreadsResponse, ThreadDto } from "@app/shared";
import { git, make_plain_folder, make_repo, ORIGIN, remove, start_daemon } from "./daemon_setup.ts";
import type { Running } from "./daemon_setup.ts";

const folders: string[] = [];
after(() => {
  for (const f of folders) remove(f);
});

const element: ElementRef = {
  selector: "main > button", tag: "button", text: "Buy", html: "<button>Buy</button>",
  rect: { x: 1, y: 2, w: 3, h: 4 }, confidence: "text",
};
const post_body = (text: string, el: ElementRef = element) => ({
  element: el, url: "http://localhost:3000/", viewport: { w: 800, h: 600 }, text,
});

async function with_daemon(
  fn: (d: Running) => Promise<void>,
  options: { dir?: string; bundlePath?: string } = {},
) {
  const dir = options.dir ?? make_repo();
  folders.push(dir);
  const d = await start_daemon(dir, { bundlePath: options.bundlePath });
  try {
    await fn(d);
  } finally {
    await d.close();
  }
}

test("post, list, claim-next, reply, resolve round trip", () =>
  with_daemon(async (d) => {
    const t = (await (await d.call("POST", paths.threads, post_body("fix this"))).json()) as ThreadDto;
    const list = (await (await d.call("GET", paths.threads)).json()) as ListThreadsResponse;
    assert.equal(list.branch, "main");
    assert.equal(list.threads.length, 1);
    const open = (await (await d.call("GET", `${paths.threads}?state=resolved`)).json()) as ListThreadsResponse;
    assert.equal(open.threads.length, 0);
    const claimed = await (await d.call("POST", paths.claimNext, { agent: "claude" })).json();
    assert.equal(claimed.thread.id, t.id);
    const replied = await (await d.call("POST", paths.messages(t.id), { author: "claude", text: "done" })).json();
    assert.equal(replied.messages.length, 2);
    const resolved = await (await d.call("POST", paths.resolve(t.id), { by: "user" })).json();
    assert.equal(resolved.status, "resolved");
    const reopened = await (await d.call("POST", paths.reopen(t.id))).json();
    assert.equal(reopened.status, "pending");
    const read = await (await d.call("POST", paths.read(t.id))).json();
    assert.equal(read.unread, false);
    const ack = await d.call("POST", paths.ack("claude"));
    assert.deepEqual(await ack.json(), { ok: true });
    const notices = await (await d.call("GET", `${paths.notices}?agent=claude`)).json();
    assert.deepEqual(notices, { notices: [] });
    const agent_thread = await d.call("POST", paths.agentThread, { agent: "claude", selector: "h1", text: "look" });
    assert.equal(agent_thread.status, 201);
    assert.equal((await agent_thread.json()).status, "waiting");
  }));

test("a refused resolve by the agent leaves no resolved event in the history", () =>
  with_daemon(async (d) => {
    const t = (await (await d.call("POST", paths.threads, post_body("fix this"))).json()) as ThreadDto;
    await d.call("POST", paths.claimNext, { agent: "claude" });
    await d.call("POST", paths.messages(t.id), { author: "claude", text: "done" });
    assert.equal((await d.call("POST", paths.resolve(t.id), { by: "agent" })).status, 409);
    const events = ((await (await d.call("GET", paths.history)).json()) as { events: HistoryEvent[] }).events;
    assert.equal(events.some((e) => e.type === "resolved"), false);
  }));

test("refused resolves by the agent leave no checkpoint ref in the repo", () =>
  with_daemon(async (d) => {
    const refs = () => git(d.dir, "for-each-ref", "--format=%(refname)", brand.refPrefix).trim().split("\n").filter(Boolean).length;
    const t = (await (await d.call("POST", paths.threads, post_body("fix this"))).json()) as ThreadDto;
    await d.call("POST", paths.claimNext, { agent: "claude" });
    await d.call("POST", paths.messages(t.id), { author: "claude", text: "done" });
    writeFileSync(join(d.dir, "a.txt"), "changed after the reply\n");
    const before = refs();
    for (let i = 0; i < 5; i++) {
      assert.equal((await d.call("POST", paths.resolve(t.id), { by: "agent" })).status, 409);
    }
    assert.equal(refs(), before);
    assert.equal((await d.call("POST", paths.resolve(t.id), { by: "user" })).status, 200);
    assert.equal(refs(), before + 1);
  }));

test("100 KB comment accepted, 150 KB rejected with 413 and daemon still answers /health", () =>
  with_daemon(async (d) => {
    const ok = await d.call("POST", paths.threads, post_body("x".repeat(100 * 1024)));
    assert.equal(ok.status, 201);
    const big = await d.call("POST", paths.threads, post_body("x".repeat(150 * 1024)));
    assert.equal(big.status, 413);
    assert.equal((await big.json()).error, "too_large");
    const huge = await d.call("POST", paths.threads, post_body("x".repeat(3 * 1024 * 1024)));
    assert.equal(huge.status, 413);
    assert.equal((await d.call("GET", paths.health)).status, 200);
  }));

test("1 MB html field is stored truncated to 4 KB", () =>
  with_daemon(async (d) => {
    const r = await d.call("POST", paths.threads, post_body("hi", { ...element, html: "h".repeat(1024 * 1024) }));
    assert.equal(r.status, 201);
    assert.equal(((await r.json()) as ThreadDto).element.html.length, 4096);
  }));

test("branch is read from git at post time: after git checkout -b feature/x a new thread has branch feature/x", () =>
  with_daemon(async (d) => {
    const a = (await (await d.call("POST", paths.threads, post_body("one"))).json()) as ThreadDto;
    assert.equal(a.branch, "main");
    git(d.dir, "checkout", "-q", "-b", "feature/x");
    const b = (await (await d.call("POST", paths.threads, post_body("two"))).json()) as ThreadDto;
    assert.equal(b.branch, "feature/x");
    assert.match(b.commit, /^[0-9a-f]{7,40}$/);
  }));

test("daemon started outside a git repo returns branch \"no-git\" and restore is rejected with no_git", () =>
  with_daemon(async (d) => {
    const t = (await (await d.call("POST", paths.threads, post_body("one"))).json()) as ThreadDto;
    assert.equal(t.branch, "no-git");
    const list = (await (await d.call("GET", paths.threads)).json()) as ListThreadsResponse;
    assert.equal(list.branch, "no-git");
    const r = await d.call("POST", paths.restore, { threadId: t.id, messageId: "m1" });
    assert.equal(r.status, 409);
    assert.equal((await r.json()).error, "no_git");
  }, { dir: make_plain_folder() }));

test("detached HEAD yields branch \"HEAD\"", () =>
  with_daemon(async (d) => {
    git(d.dir, "checkout", "-q", "--detach");
    const list = (await (await d.call("GET", paths.threads)).json()) as ListThreadsResponse;
    assert.equal(list.branch, "HEAD");
    const t = (await (await d.call("POST", paths.threads, post_body("one"))).json()) as ThreadDto;
    assert.equal(t.branch, "HEAD");
  }));

test("claim-next with a branch only returns that branch", () =>
  with_daemon(async (d) => {
    const a = (await (await d.call("POST", paths.threads, post_body("on main"))).json()) as ThreadDto;
    git(d.dir, "checkout", "-q", "-b", "other");
    const none = await (await d.call("POST", paths.claimNext, { agent: "claude", branch: "no-such-branch" })).json();
    assert.equal(none.thread, null);
    const got = await (await d.call("POST", paths.claimNext, { agent: "claude", branch: "main" })).json();
    assert.equal(got.thread.id, a.id);
  }));

test("bundle route serves the bundle with the config global prepended", async () => {
  const folder = mkdtempSync(join(tmpdir(), "bundle-"));
  folders.push(folder);
  const file = join(folder, brand.bundle);
  writeFileSync(file, "console.log('overlay');\n");
  await with_daemon(async (d) => {
    const r = await fetch(`${d.url}/${brand.bundle}`);
    assert.equal(r.status, 200);
    assert.match(r.headers.get("content-type") ?? "", /text\/javascript/);
    const text = await r.text();
    assert.ok(text.startsWith(`globalThis[${JSON.stringify(brand.configGlobal)}]`) || text.startsWith(`globalThis.${brand.configGlobal}`) || text.includes(brand.configGlobal));
    assert.ok(text.includes(`"base":"${d.url}"`) || text.includes(`base:"${d.url}"`), text);
    assert.ok(text.includes(d.token));
    assert.ok(text.endsWith("console.log('overlay');\n"));
  }, { bundlePath: file });
  await with_daemon(async (d) => {
    const r = await fetch(`${d.url}/${brand.bundle}`);
    assert.equal(r.status, 404);
    assert.equal((await r.json()).error, "not_found");
  }, { bundlePath: join(folder, "missing.js") });
});

test("GET /history returns the claimed snapshot", () =>
  with_daemon(async (d) => {
    const t = (await (await d.call("POST", paths.threads, post_body("one"))).json()) as ThreadDto;
    await d.call("POST", paths.claimNext, { agent: "claude" });
    const all = (await (await d.call("GET", paths.history)).json()) as { events: HistoryEvent[] };
    const claimed = all.events.find((e) => e.type === "claimed")!;
    assert.equal((claimed.data as { thread: ThreadDto }).thread.id, t.id);
    assert.equal((claimed.data as { thread: ThreadDto }).thread.status, "received");
    const one = (await (await d.call("GET", `${paths.history}?threadId=${t.id}`)).json()) as { events: HistoryEvent[] };
    assert.ok(one.events.every((e) => e.threadId === t.id));
  }));

test("malformed JSON is 400 invalid with a message about JSON", () =>
  with_daemon(async (d) => {
    const r = await fetch(d.url + paths.threads, {
      method: "POST",
      headers: { "content-type": "application/json", [brand.tokenHeader]: d.token },
      body: "{nope",
    });
    assert.equal(r.status, 400);
    const body = (await r.json()) as { error: string; message: string };
    assert.equal(body.error, "invalid");
    assert.match(body.message, /JSON/);
  }));

test("an allowed Origin gets Vary: Origin", () =>
  with_daemon(async (d) => {
    const r = await d.call("GET", paths.health, undefined, { origin: ORIGIN });
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("vary"), "Origin");
  }));

test("daemon binds 127.0.0.1 only", () =>
  with_daemon(async (d) => {
    assert.equal(d.daemon.address()?.address, "127.0.0.1");
  }));

test("restore over HTTP rewinds and reports discarded ids as threadId/messageId", () =>
  with_daemon(async (d) => {
    const t = (await (await d.call("POST", paths.threads, post_body("one"))).json()) as ThreadDto;
    await d.call("POST", paths.claimNext, { agent: "claude" });
    const after_claim = (await (await d.call("GET", paths.threads)).json()) as ListThreadsResponse;
    assert.ok(after_claim.restoreBlocked);
    const blocked = await d.call("POST", paths.restore, { threadId: t.id, messageId: "m1" });
    assert.equal(blocked.status, 409);
    assert.equal((await blocked.json()).error, "restore_blocked");
    await d.call("POST", paths.release(t.id));
    // A later message gives the restore something to discard.
    const replied = (await (await d.call("POST", paths.messages(t.id), { author: "user", text: "and this" })).json()) as ThreadDto;
    const m1 = t.messages[0]!.id;
    const later = replied.messages[1]!.id;
    const ok = await d.call("POST", paths.restore, { threadId: t.id, messageId: m1 });
    assert.equal(ok.status, 200);
    const result = await ok.json();
    assert.equal(result.restoredTo, m1);
    assert.deepEqual(result.discardedMessageIds, [`${t.id}/${later}`]);
  }));

test("invalid input is 400 invalid and a missing JSON body is handled", () =>
  with_daemon(async (d) => {
    const r = await d.call("POST", paths.threads, { text: "no element" });
    assert.equal(r.status, 400);
    assert.equal((await r.json()).error, "invalid");
    const long = await d.call("POST", paths.threads, post_body("x", { ...element, selector: "s".repeat(1001) }));
    assert.equal(long.status, 400);
    const bad_json = await fetch(d.url + paths.threads, {
      method: "POST",
      headers: { "content-type": "application/json", [brand.tokenHeader]: d.token },
      body: "{nope",
    });
    assert.equal(bad_json.status, 400);
    const unknown = await d.call("GET", "/nothing-here");
    assert.equal(unknown.status, 404);
  }));

// 1x1 transparent PNG
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

test("a posted screenshot is saved to a file and the thread points at it", () =>
  with_daemon(async (d) => {
    const res = await d.call("POST", paths.threads, { ...post_body("too tight"), screenshot: PNG });
    assert.equal(res.status, 201);
    const t = (await res.json()) as ThreadDto;
    assert.equal(t.element.screenshot, `${brand.dataDir}/shots/${t.id}.png`);
    assert.deepEqual(readFileSync(join(d.dir, t.element.screenshot!)), Buffer.from(PNG, "base64"));
  }));

test("a client cannot choose the screenshot path", () =>
  with_daemon(async (d) => {
    const t = (await (await d.call("POST", paths.threads, post_body("x", { ...element, screenshot: "/etc/passwd" }))).json()) as ThreadDto;
    assert.equal(t.element.screenshot, undefined);
  }));

test("a screenshot that is not a PNG or is too big is refused", () =>
  with_daemon(async (d) => {
    const notPng = await d.call("POST", paths.threads, { ...post_body("x"), screenshot: Buffer.from("hello").toString("base64") });
    assert.equal(notPng.status, 400);
    const big = Buffer.concat([Buffer.from(PNG, "base64"), Buffer.alloc(LIMITS.screenshot)]).toString("base64");
    const tooBig = await d.call("POST", paths.threads, { ...post_body("x"), screenshot: big });
    assert.equal(tooBig.status, 413);
    const list = (await (await d.call("GET", paths.threads)).json()) as ListThreadsResponse;
    assert.equal(list.threads.length, 0);
  }));
