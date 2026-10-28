import test from "node:test";
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { brand, writeConfig } from "@app/shared";
import type { ListThreadsResponse, ThreadDto } from "@app/shared";
import { startStubDaemon } from "../../shared/test-support/stub_daemon.ts";
import type { StubDaemon } from "../../shared/test-support/stub_daemon.ts";

const MAIN = join(import.meta.dirname, "../src/main.ts");

type Line = { jsonrpc?: string; id?: number; method?: string; params?: any; result?: any; error?: any };

// A scripted client: starts `channel`, keeps every stdout line, and lets the test wait for one.
function start_channel(port: number, token: string) {
  const dir = mkdtempSync(join(tmpdir(), "channel-test-"));
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "i"], { cwd: dir });
  writeConfig(dir, { port, token, origins: [], userName: "alice" });
  const env = { ...process.env };
  delete env[`${brand.envPrefix}AGENT`];
  const child = spawn("node", [MAIN, "channel"], { cwd: dir, env, stdio: ["pipe", "pipe", "pipe"] });
  const raw: string[] = [];
  const lines: Line[] = [];
  const stderr: string[] = [];
  createInterface({ input: child.stdout }).on("line", (l) => {
    raw.push(l);
    lines.push(JSON.parse(l) as Line);
  });
  child.stderr.on("data", (d) => stderr.push(String(d)));
  const exit = new Promise<number | null>((res) => child.on("exit", (code) => res(code)));
  const send = (m: object) => child.stdin.write(`${JSON.stringify(m)}\n`);
  async function until(fn: () => boolean, what: string) {
    for (let i = 0; i < 100 && !fn(); i++) await new Promise((r) => setTimeout(r, 50));
    assert.ok(fn(), `timed out waiting for ${what}`);
  }
  async function hello() {
    send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } } });
    await until(() => lines.some((l) => l.id === 1), "the initialize answer");
    send({ jsonrpc: "2.0", method: "notifications/initialized" });
  }
  const pushed = () => lines.filter((l) => l.method === "notifications/claude/channel");
  return { child, raw, lines, stderr, exit, send, until, hello, pushed };
}

async function post(stub: StubDaemon, text: string): Promise<ThreadDto> {
  const res = await fetch(`${stub.url}/threads`, {
    method: "POST",
    headers: { "content-type": "application/json", [brand.tokenHeader]: stub.token },
    body: JSON.stringify({
      element: { selector: "#hero", tag: "div", text: "Hello", html: "<div>Hello</div>", rect: { x: 1, y: 2, w: 3, h: 4 }, confidence: "text" },
      url: "http://localhost:3000/",
      viewport: { w: 1000, h: 700 },
      text,
    }),
  });
  return (await res.json()) as ThreadDto;
}

async function statuses(stub: StubDaemon): Promise<string[]> {
  const res = await fetch(`${stub.url}/threads`, { headers: { [brand.tokenHeader]: stub.token } });
  return ((await res.json()) as ListThreadsResponse).threads.map((t) => t.status);
}

async function with_stub(fn: (stub: StubDaemon) => Promise<void>) {
  const stub = await startStubDaemon();
  try {
    await fn(stub);
  } finally {
    await stub.close();
  }
}

test("initialize answers with the channel capability and the instructions, and offers no tools", async () => {
  await with_stub(async (stub) => {
    const c = start_channel(Number(new URL(stub.url).port), stub.token);
    try {
      await c.hello();
      const r = c.lines.find((l) => l.id === 1)!.result;
      assert.deepEqual(r.capabilities.experimental["claude/channel"], {});
      assert.equal(r.capabilities.tools, undefined);
      assert.equal(r.protocolVersion, "2025-06-18");
      assert.ok(r.instructions.includes(`${brand.cli} reply <id> "<what you changed>. Is it OK to close this?" --ask`));
      assert.match(r.instructions, /only the user closes/i);
      assert.ok(r.instructions.includes("If several comments arrive together, do all of them first, then reply on each one."));
      c.send({ jsonrpc: "2.0", id: 2, method: "ping" });
      c.send({ jsonrpc: "2.0", id: 3, method: "tools/list" });
      await c.until(() => c.lines.some((l) => l.id === 3), "the tools/list answer");
      assert.deepEqual(c.lines.find((l) => l.id === 2)!.result, {});
      assert.equal(c.lines.find((l) => l.id === 3)!.error.code, -32601);
    } finally {
      c.child.stdin.end();
      await c.exit;
    }
  });
});

test("initialize answers a supported protocol version as is, and any other with the newest supported one", async () => {
  await with_stub(async (stub) => {
    const cases: [string | undefined, string][] = [
      ["2024-11-05", "2024-11-05"],
      ["2025-06-18", "2025-06-18"],
      ["2025-11-25", "2025-11-25"],
      ["foo", "2025-11-25"],
      ["2026-07-28", "2025-11-25"],
      [undefined, "2025-11-25"],
    ];
    for (const [asked, answered] of cases) {
      const c = start_channel(Number(new URL(stub.url).port), stub.token);
      try {
        c.send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: asked, capabilities: {}, clientInfo: { name: "test", version: "0" } } });
        await c.until(() => c.lines.some((l) => l.id === 1), "the initialize answer");
        const r = c.lines.find((l) => l.id === 1)!.result;
        assert.equal(r.protocolVersion, answered, `asked ${asked}`);
        assert.deepEqual(r.capabilities, { experimental: { "claude/channel": {} } });
        assert.ok(r.instructions.includes("Never resolve one."));
      } finally {
        c.child.stdin.end();
        await c.exit;
      }
    }
  });
});

test("a pending thread arrives once as a channel event and shows as received; a second one follows", async () => {
  await with_stub(async (stub) => {
    const c = start_channel(Number(new URL(stub.url).port), stub.token);
    try {
      await c.hello();
      const first = await post(stub, "make this red");
      await c.until(() => c.pushed().length === 1, "the first event");
      const e = c.pushed()[0]!.params;
      assert.ok(e.content.includes(`THREAD ${first.id}`));
      assert.ok(e.content.includes("make this red"));
      assert.deepEqual(e.meta, { thread_id: first.id, branch: "main" });
      assert.deepEqual(await statuses(stub), ["received"]);
      const second = await post(stub, "and this blue");
      await c.until(() => c.pushed().length === 2, "the second event");
      assert.ok(c.pushed()[1]!.params.content.includes(`THREAD ${second.id}`));
      await new Promise((r) => setTimeout(r, 2500));
      assert.equal(c.pushed().length, 2);
      assert.ok(c.raw.every((l) => l.startsWith("{")));
    } finally {
      c.child.stdin.end();
      await c.exit;
    }
  });
});

test("a restore notice is sent once, before the thread", async () => {
  await with_stub(async (stub) => {
    stub.seedNotice({ id: "n1", at: Date.now(), restoredToMessage: "m2", files: ["src/app.css"], discardedThreads: [] });
    const c = start_channel(Number(new URL(stub.url).port), stub.token);
    try {
      await c.hello();
      await post(stub, "hello");
      await c.until(() => c.pushed().length === 2, "the notice and the thread");
      assert.ok(c.pushed()[0]!.params.content.startsWith("NOTICE n1"));
      assert.ok(c.pushed()[1]!.params.content.startsWith("THREAD"));
      await new Promise((r) => setTimeout(r, 2500));
      assert.equal(c.pushed().length, 2);
    } finally {
      c.child.stdin.end();
      await c.exit;
    }
  });
});

test("with the daemon down it sends nothing, says so on stderr once, and exits when stdin closes", async () => {
  const stub = await startStubDaemon();
  const port = Number(new URL(stub.url).port);
  const token = stub.token;
  await stub.close();
  const c = start_channel(port, token);
  try {
    await c.hello();
    await new Promise((r) => setTimeout(r, 2500));
    assert.equal(c.pushed().length, 0);
    assert.equal(c.lines.length, 1);
    const said = c.stderr.join("").split("\n").filter((l) => l.includes("cannot reach"));
    assert.equal(said.length, 1, c.stderr.join(""));
    assert.ok(!c.stderr.join("").includes("    at "), "no stack trace");
  } finally {
    c.child.stdin.end();
  }
  assert.equal(await c.exit, 0);
});
