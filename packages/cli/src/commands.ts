import { spawn, execFileSync } from "node:child_process";
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { createServer } from "node:net";
import { userInfo } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { brand, paths, statusLabel, writeConfig, findConfig } from "@app/shared";
import type {
  ClaimNextResponse,
  HistoryResponse,
  ListThreadsResponse,
  NoticesResponse,
  ThreadDto,
} from "@app/shared";
import { channel } from "./channel.ts";
import { CliError, connect, currentBranch } from "./client.ts";
import type { Client } from "./client.ts";
import { formatNotice, formatThread, formatThreads } from "./format.ts";

const OPTIONS = {
  as: { type: "string" },
  ask: { type: "boolean" },
  origin: { type: "string", multiple: true },
  port: { type: "string" },
  user: { type: "string" },
  selector: { type: "string" },
  mention: { type: "string" },
  timeout: { type: "string" },
} as const;

const USAGE = [
  `usage: ${brand.cli} <command>`,
  "  init [--origin <url>] [--port <n>] [--user <name>]",
  "  start",
  "  next [--as name]",
  "  reply <id> <text> [--ask] [--as name]",
  '  comment --selector <css> <text> [--mention me] [--as name]',
  "  wait [--timeout s] [--as name]",
  "  ack [--as name]",
  "  status",
  "  history [id]",
  "  channel [--as name]",
].join("\n");

const NONE = "no pending threads on this branch";

type Args = ReturnType<typeof parse>;
function parse(argv: string[]) {
  return parseArgs({ args: argv, options: OPTIONS, allowPositionals: true });
}

function freePort(): Promise<number> {
  return new Promise((res, rej) => {
    const s = createServer();
    s.once("error", rej);
    s.listen(0, "127.0.0.1", () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => res(port));
    });
  });
}

function clean_origin(given: string): string {
  const bad = new CliError("--origin must look like http://localhost:3000");
  let url: URL;
  try {
    url = new URL(given);
  } catch {
    throw bad;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw bad;
  if (url.pathname !== "/" || url.search !== "" || url.hash !== "" || given.includes("?") || given.includes("#")) throw bad;
  return url.origin;
}

async function init(cwd: string, a: Args): Promise<number> {
  const existing = findConfig(cwd);
  const same = existing && resolve(existing.dir) === resolve(cwd) ? existing.config : undefined;
  const port = a.values.port ? Number(a.values.port) : (same?.port ?? (await freePort()));
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new CliError("--port must be a number from 1 to 65535");
  const origins = a.values.origin?.map(clean_origin);
  const config = {
    port,
    token: same?.token ?? randomBytes(24).toString("hex"),
    origins: origins ?? same?.origins ?? ["http://localhost:3000", "http://localhost:5173"],
    userName: a.values.user ?? same?.userName ?? userInfo().username,
  };
  writeConfig(cwd, config);
  try {
    const rel = execFileSync("git", ["rev-parse", "--git-path", "info/exclude"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const file = isAbsolute(rel) ? rel : join(cwd, rel);
    const line = `${brand.dataDir}/`;
    const have = existsSync(file) ? readFileSync(file, "utf8").split("\n") : [];
    if (!have.includes(line)) {
      mkdirSync(join(file, ".."), { recursive: true });
      appendFileSync(file, `${have.length && have[have.length - 1] !== "" ? "\n" : ""}${line}\n`);
    }
  } catch {
    console.log(`warning: not a git repository; threads are kept on branch "no-git" and restore is unavailable.`);
  }
  console.log(`initialised ${brand.dataDir}/${brand.configFile} (port ${port}, user ${config.userName})`);
  console.log(`Add this to your dev site, then run: ${brand.cli} start`);
  console.log(`<script src="http://127.0.0.1:${port}/${brand.bundle}"></script>`);
  install_skill(cwd);
  return 0;
}

function install_skill(cwd: string): void {
  const source = resolve(import.meta.dirname, `../../../skills/${brand.cli}/SKILL.md`);
  const shown = join(".claude", "skills", brand.cli, "SKILL.md");
  const target = join(cwd, shown);
  if (existsSync(target)) {
    console.log("skill already there, left as is");
    return;
  }
  if (!existsSync(source)) {
    console.log(`warning: skill file not found: ${source}`);
    return;
  }
  try {
    mkdirSync(join(target, ".."), { recursive: true });
    copyFileSync(source, target);
  } catch (err) {
    console.log(`could not install the skill: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }
  console.log(`installed skill ${shown}`);
}

function start(cwd: string): Promise<number> {
  const found = findConfig(cwd);
  if (!found) throw new CliError(`no ${brand.cli} project found here; run ${brand.cli} init`);
  const entry = resolve(import.meta.dirname, "../../daemon/src/interface/main.ts");
  if (!existsSync(entry)) throw new CliError(`daemon entry not found: ${entry}`);
  return new Promise((res) => {
    const child = spawn("node", [entry, found.dir], { stdio: "inherit" });
    for (const signalName of ["SIGINT", "SIGTERM"] as const) process.on(signalName, () => child.kill(signalName));
    child.on("exit", (code) => res(code ?? 0));
  });
}

async function claim(c: Client, cwd: string): Promise<ThreadDto | null> {
  const branch = currentBranch(cwd);
  const r = await c.post<ClaimNextResponse>(paths.claimNext, { agent: c.agent, ...(branch ? { branch } : {}) });
  return r.thread;
}

// Takes every pending thread, oldest first. If a later claim fails, keeps what it already got; the next call retries the rest.
async function claim_all_pending(c: Client, cwd: string): Promise<ThreadDto[]> {
  const got: ThreadDto[] = [];
  try {
    for (let t = await claim(c, cwd); t; t = await claim(c, cwd)) got.push(t);
  } catch (e) {
    if (!got.length) throw e;
  }
  return got;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function runOnce(cmd: string, c: Client, cwd: string, a: Args): Promise<number> {
  const [, ...pos] = a.positionals;
  switch (cmd) {
    case "next": {
      const got = await claim_all_pending(c, cwd);
      console.log(got.length ? formatThreads(got) : NONE);
      return 0;
    }
    case "wait": {
      const secs = a.values.timeout === undefined ? 60 : Number(a.values.timeout);
      if (!(secs >= 0)) throw new CliError("--timeout must be a number of seconds");
      const deadline = Date.now() + secs * 1000;
      for (;;) {
        const got = await claim_all_pending(c, cwd);
        if (got.length) {
          console.log(formatThreads(got));
          return 0;
        }
        const left = deadline - Date.now();
        if (left <= 0) {
          console.log(NONE);
          return 0;
        }
        await sleep(Math.min(2000, left));
      }
    }
    case "reply": {
      const [id, ...words] = pos;
      if (!id || !words.length) throw new CliError("usage: reply <id> <text> [--ask]");
      const t = await c.post<ThreadDto>(paths.messages(id), { author: c.agent, text: words.join(" "), ...(a.values.ask ? { ask: true } : {}) });
      console.log(`replied to ${t.id}; status: ${statusLabel(t.status)}`);
      return 0;
    }
    case "comment": {
      const selector = a.values.selector;
      if (!selector || !pos.length) throw new CliError("usage: comment --selector <css> <text> [--mention me]");
      let text = pos.join(" ");
      if (a.values.mention === "me") text = `@${c.config.userName} ${text}`;
      const t = await c.post<ThreadDto>(paths.agentThread, { agent: c.agent, selector, text });
      console.log(`started ${t.id}; status: ${statusLabel(t.status)}`);
      return 0;
    }
    case "ack": {
      await c.post(paths.ack(c.agent));
      console.log("acknowledged");
      return 0;
    }
    case "status": {
      const r = await c.get<ListThreadsResponse>(paths.threads);
      console.log(`branch: ${r.branch}`);
      console.log(`agent: ${r.agent.name ?? "none"} (${r.agent.online ? "online" : "offline"})`);
      if (r.restoreBlocked) console.log(`restore blocked: ${r.restoreBlocked}`);
      if (!r.threads.length) console.log("no threads");
      for (const t of r.threads) console.log(`#${t.n} ${t.id}  ${statusLabel(t.status)}  ${t.element.selector}`);
      return 0;
    }
    case "history": {
      const id = pos[0];
      const r = await c.get<HistoryResponse>(paths.history, id ? { threadId: id } : undefined);
      if (!r.events.length) console.log("no history");
      for (const e of r.events) {
        console.log(`${e.seq}  ${new Date(e.at).toISOString()}  ${e.type}  ${e.threadId ?? "-"}`);
        const snap = (e.data as { thread?: ThreadDto } | null)?.thread;
        if (e.type === "claimed" && snap) console.log(formatThread(snap).replace(/^/gm, "    "));
      }
      return 0;
    }
    default:
      throw new CliError(USAGE);
  }
}

// stdout belongs to the protocol here, so every message goes to stderr.
async function run_channel(cwd: string, a: Args): Promise<number> {
  try {
    const c = connect(cwd, a.values.as);
    return await channel(c, () => claim(c, cwd));
  } catch (e) {
    console.error(e instanceof CliError ? e.message : `error: ${(e as Error).message}`);
    return 1;
  }
}

export async function run(argv: string[], cwd: string): Promise<number> {
  try {
    const a = parse(argv);
    const cmd = a.positionals[0];
    if (!cmd) throw new CliError(USAGE);
    if (cmd === "init") return await init(cwd, a);
    if (cmd === "start") return await start(cwd);
    if (cmd === "channel") return await run_channel(cwd, a);
    if (cmd === "resolve") throw new CliError(`only the user closes a thread; ask with: ${brand.cli} reply <id> "<text>" --ask`);
    if (!["next", "wait", "reply", "comment", "ack", "status", "history"].includes(cmd)) throw new CliError(USAGE);
    const c = connect(cwd, a.values.as);
    const n = await c.get<NoticesResponse>(paths.notices, { agent: c.agent });
    for (const notice of n.notices) console.log(`${formatNotice(notice)}\n`);
    return await runOnce(cmd, c, cwd, a);
  } catch (e) {
    console.log(e instanceof CliError ? e.message : `error: ${(e as Error).message}`);
    return 1;
  }
}
