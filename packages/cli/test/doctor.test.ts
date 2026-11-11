import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeConfig } from "@app/shared";
import { doctor } from "../src/doctor.ts";

const NOW = 1_000_000_000;
const idle = { name: null, online: false, seenAt: null };

type Answers = { health: (dir: string) => object; agent?: object };

/** A real folder in a git repo, with a daemon that answers /health and /threads with what the test gives it. */
async function withDaemon(answers: Answers, fn: (dir: string, port: number) => Promise<void>) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "doctor-")));
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "i"], { cwd: dir });
  const server = createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(req.url === "/health" ? answers.health(dir) : { agent: answers.agent ?? idle }));
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const port = (server.address() as { port: number }).port;
  writeConfig(dir, { port, token: "t", origins: [], userName: "alice" });
  try {
    await fn(dir, port);
  } finally {
    server.close();
  }
}

const healthy = (dir: string) => ({ ok: true, dir, branch: "main", origins: ["http://localhost:3000"], pairedAt: NOW - 120_000 });

test("no project: one FAIL with the command to run", async () => {
  const r = await doctor(mkdtempSync(join(tmpdir(), "doctor-none-")));
  assert.equal(r.ok, false);
  assert.match(r.text, /FAIL +folder .*\n +fix: tackboard start/);
});

test("nothing answering on the port is a FAIL", async () => {
  await withDaemon({ health: healthy }, async (dir) => {
    writeConfig(dir, { port: 1, token: "t", origins: [], userName: "a" });
    const r = await doctor(dir, NOW);
    assert.equal(r.ok, false);
    assert.match(r.text, /FAIL +daemon +nothing answers on port 1/);
  });
});

test("a daemon that keeps its folder hidden belongs to another project", async () => {
  await withDaemon({ health: () => ({ ok: true }) }, async (dir) => {
    const r = await doctor(dir, NOW);
    assert.equal(r.ok, false);
    assert.match(r.text, /FAIL +daemon .*another project/);
    assert.match(r.text, /fix: stop it \(lsof/);
  });
});

test("a daemon serving another folder is a FAIL", async () => {
  await withDaemon({ health: (dir) => ({ ...healthy(dir), dir: "/somewhere/else" }) }, async (dir) => {
    const r = await doctor(dir, NOW);
    assert.equal(r.ok, false);
    assert.match(r.text, /FAIL +daemon .*serves \/somewhere\/else, not this folder/);
  });
});

test("a branch that differs from the daemon's is a FAIL that names both", async () => {
  await withDaemon({ health: healthy }, async (dir) => {
    execFileSync("git", ["checkout", "-q", "-b", "feat-x"], { cwd: dir });
    const r = await doctor(dir, NOW);
    assert.equal(r.ok, false);
    assert.match(r.text, /FAIL +branch +the daemon is on main, this folder is on feat-x/);
    assert.match(r.text, /fix: check out main here/);
  });
});

test("everything fine: no FAIL, the agent's last ask shows its age, a missing skill is only a warn", async () => {
  await withDaemon({ health: healthy, agent: { name: "claude", online: true, seenAt: NOW - 8_000 } }, async (dir) => {
    const r = await doctor(dir, NOW);
    assert.equal(r.ok, true, r.text);
    assert.match(r.text, /ok +daemon +serves this folder/);
    assert.match(r.text, /ok +branch +main/);
    assert.match(r.text, /ok +extension +paired 2 min ago/);
    assert.match(r.text, /warn +skill /);
    assert.match(r.text, /ok +agent +claude asked 8 s ago/);
    mkdirSync(join(dir, ".claude", "skills", "tackboard"), { recursive: true });
    writeFileSync(join(dir, ".claude", "skills", "tackboard", "SKILL.md"), "x");
    assert.match((await doctor(dir, NOW)).text, /ok +skill /);
  });
});

test("an agent that asked 2 minutes ago is idle for doctor too, as in the panel and in status", async () => {
  await withDaemon({ health: healthy, agent: { name: "claude", online: false, seenAt: NOW - 120_000 } }, async (dir) => {
    assert.match((await doctor(dir, NOW)).text, /ok +agent +claude asked 2 min ago/);
  });
});

test("an agent that stopped asking, or never asked, gets a warn with what to tell it", async () => {
  await withDaemon({ health: healthy, agent: { name: "claude", online: false, seenAt: NOW - 14 * 60_000 } }, async (dir) => {
    assert.match((await doctor(dir, NOW)).text, /warn +agent +claude last asked 14 min ago\n +fix: tell the agent: run `tackboard wait`/);
  });
  await withDaemon({ health: (dir) => ({ ...healthy(dir), pairedAt: null }) }, async (dir) => {
    const r = await doctor(dir, NOW);
    assert.match(r.text, /warn +agent +no agent has asked/);
    assert.match(r.text, /warn +extension +has not paired/);
    assert.equal(r.ok, true);
  });
});
