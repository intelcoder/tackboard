import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { brand, findConfig, paths } from "@app/shared";
import type { ThreadDto } from "@app/shared";
import { CliError } from "./client.ts";
import { formatThread } from "./format.ts";

const MAIN = resolve(import.meta.dirname, "main.ts");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Adds the channel server to the project's .mcp.json and leaves any other server alone. Absolute paths, so nothing has to be on the PATH. */
export function writeMcpJson(dir: string): "created" | "added" | "present" {
  const file = join(dir, ".mcp.json");
  const had = existsSync(file);
  let json: { mcpServers?: Record<string, unknown> } = {};
  if (had) {
    try {
      json = JSON.parse(readFileSync(file, "utf8"));
    } catch {
      throw new CliError(".mcp.json is not valid JSON; fix or delete it, then run init again");
    }
  }
  json.mcpServers ??= {};
  if (json.mcpServers[brand.cli]) return "present";
  json.mcpServers[brand.cli] = { command: process.execPath, args: [MAIN, "channel"] };
  writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`);
  return had ? "added" : "created";
}

async function daemonUp(port: number): Promise<boolean> {
  try {
    return (await fetch(`http://127.0.0.1:${port}${paths.health}`, { signal: AbortSignal.timeout(800) })).ok;
  } catch {
    return false;
  }
}

/** Starts the daemon if it is not running (it keeps running on its own), then Claude Code with the channel on, so one command does it all. */
export async function claudeCommand(args: string[], cwd: string): Promise<number> {
  const found = findConfig(cwd);
  if (!found) throw new CliError(`no ${brand.cli} project found here; run ${brand.cli} init`);
  const { port } = found.config;
  if (!(await daemonUp(port))) {
    spawn(process.execPath, [MAIN, "start"], { cwd: found.dir, detached: true, stdio: "ignore" }).unref();
    for (let i = 0; i < 25 && !(await daemonUp(port)); i++) await sleep(200);
    if (!(await daemonUp(port))) throw new CliError(`the daemon did not start on port ${port}; run ${brand.cli} start to see why`);
    console.log(`started the daemon on port ${port}`);
  }
  return new Promise((res) => {
    const child = spawn("claude", ["--dangerously-load-development-channels", `server:${brand.cli}`, ...args], { cwd: found.dir, stdio: "inherit" });
    child.on("error", () => {
      console.log("could not run claude; is Claude Code installed?");
      res(1);
    });
    child.on("exit", (code) => res(code ?? 0));
  });
}

/** What the headless agent may do: edit files in the project, and run the one command that answers a comment. */
export const agentArgs = (prompt: string) => ["-p", prompt, "--permission-mode", "acceptEdits", `--allowedTools=Bash(${brand.cli} reply:*)`];

export const agentPrompt = (thread: ThreadDto) =>
  `You are answering a ${brand.name} comment and nobody is watching. Work in this folder. Do what the comment asks, then run the reply command the instructions below name, and stop.\n\n${formatThread(thread)}`;

/** A folder with a ${brand.cli} command in it that runs this checkout, so the headless agent can reply even when the command is not installed. */
function shimDir(): string {
  const dir = mkdtempSync(join(tmpdir(), `${brand.cli}-agent-`));
  const file = join(dir, brand.cli);
  writeFileSync(file, `#!/bin/sh\nexec "${process.execPath}" "${MAIN}" "$@"\n`);
  chmodSync(file, 0o755);
  return dir;
}

/** For `start --agent`: takes each new comment and runs a headless Claude Code on it, one at a time, until `stop.done`. */
export async function runAgent(claimOne: () => Promise<ThreadDto | null>, cwd: string, stop: { done: boolean }): Promise<void> {
  const env = { ...process.env, PATH: `${shimDir()}:${process.env.PATH ?? ""}` };
  let last = "";
  const say = (text: string) => {
    if (text !== last) console.log(`${brand.cli} agent: ${text}`);
    last = text;
  };
  while (!stop.done) {
    try {
      const thread = await claimOne();
      if (thread) {
        say(`working on ${thread.id}`);
        const code = await new Promise<number>((res) => {
          const child = spawn("claude", agentArgs(agentPrompt(thread)), { cwd, env, stdio: ["ignore", "inherit", "inherit"] });
          child.on("error", () => res(127));
          child.on("exit", (c) => res(c ?? 1));
        });
        if (code === 127) return void say("could not run claude; is Claude Code installed? The agent is off, comments stay pending");
        say(code === 0 ? `answered ${thread.id}` : `claude stopped with code ${code} on ${thread.id}; it is claimed and comes back after 30 minutes`);
        continue;
      }
      say("waiting for comments");
    } catch (e) {
      say(e instanceof Error ? e.message : String(e));
    }
    await sleep(2000);
  }
}
