import test from "node:test";
import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { brand, findConfig, statusLabel, writeConfig } from "@app/shared";
import type { ListThreadsResponse, ThreadDto } from "@app/shared";
import { startStubDaemon } from "../../shared/test-support/stub_daemon.ts";
import type { StubDaemon } from "../../shared/test-support/stub_daemon.ts";

const MAIN = join(import.meta.dirname, "../src/main.ts");

function cli(cwd: string, args: string[]): Promise<{ stdout: string; code: number }> {
  const env = { ...process.env };
  delete env[`${brand.envPrefix}AGENT`];
  return new Promise((resolve) => {
    execFile("node", [MAIN, ...args], { cwd, env }, (err, stdout) => {
      resolve({ stdout, code: err ? ((err as { code?: number }).code ?? 1) : 0 });
    });
  });
}

function project(stub: StubDaemon, git?: string): string {
  const dir = mkdtempSync(join(tmpdir(), "cli-test-"));
  if (git) {
    execFileSync("git", ["init", "-q", "-b", git], { cwd: dir });
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "i"], { cwd: dir });
  }
  writeConfig(dir, { port: Number(new URL(stub.url).port), token: stub.token, origins: [], userName: "alice" });
  return dir;
}

const headers = (stub: StubDaemon) => ({ "content-type": "application/json", [brand.tokenHeader]: stub.token });

async function post(stub: StubDaemon, text: string, selector = "#hero"): Promise<ThreadDto> {
  const res = await fetch(`${stub.url}/threads`, {
    method: "POST",
    headers: headers(stub),
    body: JSON.stringify({
      element: { selector, tag: "div", text: "Hello", html: "<div>Hello</div>", rect: { x: 1, y: 2, w: 3, h: 4 }, confidence: "text" },
      url: "http://localhost:3000/",
      viewport: { w: 1000, h: 700 },
      text,
    }),
  });
  return (await res.json()) as ThreadDto;
}

async function list(stub: StubDaemon): Promise<ListThreadsResponse> {
  const res = await fetch(`${stub.url}/threads`, { headers: headers(stub) });
  return (await res.json()) as ListThreadsResponse;
}

async function withStub(fn: (stub: StubDaemon) => Promise<void>) {
  const stub = await startStubDaemon();
  try {
    await fn(stub);
  } finally {
    await stub.close();
  }
}

test("init writes config and excludes the data dir from git status", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cli-test-"));
  execFileSync("git", ["init", "-q"], { cwd: dir });
  const r = await cli(dir, ["init", "--port", "4999", "--user", "bob", "--origin", "http://localhost:3000"]);
  assert.equal(r.code, 0);
  assert.ok(r.stdout.includes(`<script src="http://127.0.0.1:4999/${brand.bundle}"></script>`));
  const found = findConfig(dir);
  assert.ok(found);
  assert.equal(found.config.port, 4999);
  assert.equal(found.config.userName, "bob");
  assert.deepEqual(found.config.origins, ["http://localhost:3000"]);
  assert.match(found.config.token, /^[0-9a-f]{48}$/);
  assert.ok(existsSync(join(dir, brand.dataDir)));
  // Only the installed skill shows up, so the user can commit it.
  assert.equal(execFileSync("git", ["status", "--porcelain"], { cwd: dir, encoding: "utf8" }), "?? .claude/\n");
});

test("init in a non-git directory warns and next works on branch no-git", async () => {
  await withStub(async (stub) => {
    const dir = mkdtempSync(join(tmpdir(), "cli-test-"));
    const r = await cli(dir, ["init"]);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /warning.*not a git repository/i);
    writeConfig(dir, { port: Number(new URL(stub.url).port), token: stub.token, origins: [], userName: "alice" });
    stub.setBranch("no-git");
    await post(stub, "fix me");
    const n = await cli(dir, ["next"]);
    assert.equal(n.code, 0);
    assert.match(n.stdout, /branch: no-git/);
  });
});

test("next prints THREAD, branch, selector, comment, and the instruction block", async () => {
  await withStub(async (stub) => {
    const t = await post(stub, "make this red");
    const r = await cli(project(stub), ["next"]);
    assert.equal(r.code, 0);
    assert.match(r.stdout, new RegExp(`THREAD ${t.id}`));
    assert.match(r.stdout, /branch: main/);
    assert.ok(r.stdout.includes("#hero"));
    assert.ok(r.stdout.includes("make this red"));
    assert.ok(r.stdout.includes(`${brand.cli} reply ${t.id}`));
    assert.ok(r.stdout.includes(`${brand.cli} resolve ${t.id}`));
    assert.equal((await list(stub)).threads[0]!.status, "received");
  });
});

test('next prints "no pending threads on this branch" and exits 0 when empty', async () => {
  await withStub(async (stub) => {
    const r = await cli(project(stub), ["next"]);
    assert.equal(r.code, 0);
    assert.ok(r.stdout.includes("no pending threads on this branch"));
  });
});

test("after a restore notice is seeded, next output begins with a NOTICE block naming the files, until ack", async () => {
  await withStub(async (stub) => {
    const dir = project(stub);
    stub.seedNotice({ id: "n1", at: Date.now(), restoredToMessage: "m2", files: ["src/app.css"], discardedThreads: ["t9"] });
    await post(stub, "hello");
    const a = await cli(dir, ["next"]);
    assert.ok(a.stdout.startsWith("NOTICE"), a.stdout);
    assert.ok(a.stdout.includes("src/app.css"));
    assert.ok(a.stdout.includes("do not continue t9"));
    assert.ok(a.stdout.indexOf("NOTICE") < a.stdout.indexOf("THREAD"));
    const again = await cli(dir, ["status"]);
    assert.ok(again.stdout.startsWith("NOTICE"));
    await cli(dir, ["ack"]);
    const b = await cli(dir, ["status"]);
    assert.ok(!b.stdout.includes("NOTICE"));
  });
});

test("reply --ask leaves the thread waiting", async () => {
  await withStub(async (stub) => {
    const dir = project(stub);
    const t = await post(stub, "which colour?");
    await cli(dir, ["next"]);
    const r = await cli(dir, ["reply", t.id, "blue or", "green?", "--ask"]);
    assert.equal(r.code, 0);
    const got = (await list(stub)).threads[0]!;
    assert.equal(got.status, "waiting");
    assert.equal(got.messages.at(-1)!.text, "blue or green?");
    assert.equal(got.messages.at(-1)!.author, "claude-main");
  });
});

test("comment with --mention me starts a waiting thread whose text starts with the configured user name", async () => {
  await withStub(async (stub) => {
    const dir = project(stub);
    const r = await cli(dir, ["comment", "--selector", ".nav", "--mention", "me", "please", "look", "--as", "codex"]);
    assert.equal(r.code, 0);
    const t = (await list(stub)).threads[0]!;
    assert.equal(t.status, "waiting");
    assert.equal(t.element.selector, ".nav");
    assert.equal(t.agent, "codex");
    assert.equal(t.messages[0]!.text, "@alice please look");
  });
});

test("wait returns a thread that appears after 1 second and times out cleanly otherwise", async () => {
  await withStub(async (stub) => {
    const dir = project(stub);
    const pending = cli(dir, ["wait", "--timeout", "10"]);
    await new Promise((r) => setTimeout(r, 1000));
    const t = await post(stub, "late arrival");
    const r = await pending;
    assert.equal(r.code, 0);
    assert.ok(r.stdout.includes(`THREAD ${t.id}`));
    const none = await cli(dir, ["wait", "--timeout", "1"]);
    assert.equal(none.code, 0);
    assert.ok(none.stdout.includes("no pending threads on this branch"));
  });
});

test("an agent on branch B does not see threads from branch A", async () => {
  await withStub(async (stub) => {
    const dir = project(stub, "B");
    await post(stub, "on main only");
    const r = await cli(dir, ["next"]);
    assert.ok(r.stdout.includes("no pending threads on this branch"));
    stub.setBranch("B");
    const t = await post(stub, "on B");
    stub.setBranch("main");
    const r2 = await cli(dir, ["next"]);
    assert.ok(r2.stdout.includes(`THREAD ${t.id}`));
    assert.ok(r2.stdout.includes("branch: B"));
  });
});

test('commands outside an initialised project exit 1 with "run tackboard init"', async () => {
  const dir = mkdtempSync(join(tmpdir(), "cli-test-"));
  for (const cmd of ["next", "status", "history"]) {
    const r = await cli(dir, [cmd]);
    assert.equal(r.code, 1, cmd);
    assert.ok(r.stdout.includes(`run ${brand.cli} init`), r.stdout);
  }
});

test("history prints the claimed snapshot", async () => {
  await withStub(async (stub) => {
    const dir = project(stub);
    const t = await post(stub, "snapshot me");
    await cli(dir, ["next"]);
    await post(stub, "second");
    const r = await cli(dir, ["history", t.id]);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /claimed/);
    assert.ok(r.stdout.includes(`THREAD ${t.id}`));
    assert.ok(r.stdout.includes("snapshot me"));
    assert.ok(!r.stdout.includes("second"));
    const all = await cli(dir, ["history"]);
    assert.match(all.stdout, /posted/);
  });
});

test("status output uses the shared status labels", async () => {
  await withStub(async (stub) => {
    const dir = project(stub);
    await post(stub, "a");
    await cli(dir, ["comment", "--selector", "#b", "question"]);
    const r = await cli(dir, ["status"]);
    assert.equal(r.code, 0);
    assert.ok(r.stdout.includes(statusLabel("pending")));
    assert.ok(r.stdout.includes(statusLabel("waiting")));
    assert.ok(r.stdout.includes("branch: main"));
  });
});

const SKILL_SOURCE = join(import.meta.dirname, `../../../skills/${brand.cli}/SKILL.md`);
const SKILL_COPY = join(".claude", "skills", brand.cli, "SKILL.md");

test("init copies the skill into the project and says so", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cli-test-"));
  execFileSync("git", ["init", "-q"], { cwd: dir });
  const r = await cli(dir, ["init"]);
  assert.equal(r.code, 0);
  assert.ok(r.stdout.includes(`installed skill ${SKILL_COPY}`), r.stdout);
  assert.equal(readFileSync(join(dir, SKILL_COPY), "utf8"), readFileSync(SKILL_SOURCE, "utf8"));
});

test("a second init leaves a hand-edited skill as it is", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cli-test-"));
  await cli(dir, ["init"]);
  writeFileSync(join(dir, SKILL_COPY), "my own notes\n");
  const r = await cli(dir, ["init"]);
  assert.equal(r.code, 0);
  assert.ok(r.stdout.includes("skill already there, left as is"), r.stdout);
  assert.ok(!r.stdout.includes("installed skill"));
  assert.equal(readFileSync(join(dir, SKILL_COPY), "utf8"), "my own notes\n");
});

test("init outside git still copies the skill", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cli-test-"));
  const r = await cli(dir, ["init"]);
  assert.match(r.stdout, /not a git repository/);
  assert.ok(existsSync(join(dir, SKILL_COPY)));
});

test("init says why the skill could not be copied when the target path is a file", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cli-test-"));
  mkdirSync(join(dir, ".claude", "skills"), { recursive: true });
  writeFileSync(join(dir, ".claude", "skills", brand.cli), "in the way\n");
  const r = await cli(dir, ["init"]);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /could not install the skill: \S/);
  assert.ok(findConfig(dir), "config must still be written");
});

test("init says why the skill could not be copied when .claude is read-only", { skip: process.getuid?.() === 0 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "cli-test-"));
  mkdirSync(join(dir, ".claude"));
  chmodSync(join(dir, ".claude"), 0o555);
  try {
    const r = await cli(dir, ["init"]);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /could not install the skill: \S/);
    assert.ok(findConfig(dir), "config must still be written");
  } finally {
    chmodSync(join(dir, ".claude"), 0o755);
  }
});
