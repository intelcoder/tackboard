import { spawn, execFileSync } from "node:child_process";
import { appendFileSync, closeSync, copyFileSync, existsSync, mkdirSync, openSync, readFileSync, readSync, statSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { createServer } from "node:net";
import { userInfo } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { agentState, brand, paths, statusLabel, writeConfig, findConfig } from "@app/shared";
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
import { doctor } from "./doctor.ts";
import { claudeCommand, runAgent, writeMcpJson } from "./launch.ts";
import { firstExisting } from "./where.ts";

const OPTIONS = {
  as: { type: "string" },
  ask: { type: "boolean" },
  agent: { type: "boolean" },
  origin: { type: "string", multiple: true },
  port: { type: "string" },
  user: { type: "string" },
  selector: { type: "string" },
  mention: { type: "string" },
  timeout: { type: "string" },
  branch: { type: "string" },
  url: { type: "string" },
  json: { type: "boolean" },
  follow: { type: "boolean", short: "f" },
} as const;

const USAGE = [
  `usage: ${brand.cli} <command>`,
  "  init [--origin <url>] [--port <n>] [--user <name>]",
  "  start [--agent] [--origin <url>] [--port <n>] [--user <name>]   (sets the folder up first if it has not been)",
  "  claude [claude options]",
  "  next [--as name]",
  "  reply <id> <text> [--ask] [--as name]",
  '  comment --selector <css> <text> [--mention me] [--as name]',
  "  wait [--timeout s] [--as name]",
  "  ack [--as name]",
  "  status",
  "  doctor                             (checks daemon, folder, branch, extension, skill and agent; says what to run)",
  `  logs [-f]                          (what the daemon did; needs ${brand.envPrefix}DEBUG=1 on start; -f keeps following)`,
  "  history [id] [--branch <name>] [--url <page>] [--json]",
  "  channel [--as name]",
  "  extension",
].join("\n");

const NONE = "no pending threads on this branch";
const none_message = (why?: string) => (why ? `${NONE}: ${why}` : NONE);

type Args = ReturnType<typeof parse>;
function parse(argv: string[]) {
  return parseArgs({ args: argv, options: OPTIONS, allowPositionals: true });
}

function tryPort(port: number): Promise<number> {
  return new Promise((res, rej) => {
    const s = createServer();
    s.once("error", rej);
    s.listen(port, "127.0.0.1", () => {
      const got = (s.address() as { port: number }).port;
      s.close(() => res(got));
    });
  });
}

/** The project's own port when it is already in the extension's range (so running init again never moves a running daemon), else the first free port of the range (one per project running at once), else the old port, else any free one. */
export async function choosePort(same: { port: number } | undefined, first: number = brand.pairPort, span: number = brand.pairSpan): Promise<number> {
  if (same && same.port >= first && same.port < first + span) return same.port;
  for (let port = first; port < first + span; port++) {
    try {
      return await tryPort(port);
    } catch {
      // taken by another project's daemon: try the next one
    }
  }
  if (same) return same.port;
  // stderr and loud: the extension looks only in the range, so it will not find this daemon.
  console.error(`\n!! ports ${first} to ${first + span - 1} are all taken by other daemons, so the extension cannot find this one.\n!! Stop one: lsof -nP -iTCP:${first}-${first + span - 1} -sTCP:LISTEN\n!! Or paste this project's .${brand.cli}/config.json into the extension's "Add a site" page.\n`);
  return tryPort(0);
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
  const port = a.values.port ? Number(a.values.port) : await choosePort(same);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new CliError("--port must be a number from 1 to 65535");
  const origins = a.values.origin?.map(clean_origin);
  const config = {
    port,
    token: same?.token ?? randomBytes(24).toString("hex"),
    origins: origins ?? same?.origins ?? ["http://localhost:3000", "http://localhost:5173"],
    userName: a.values.user ?? same?.userName ?? userInfo().username,
  };
  writeConfig(cwd, config);
  // The channel entry for Claude Code. A file made here has this machine's paths in it, so it stays out of git.
  let mcp: ReturnType<typeof writeMcpJson> | undefined;
  try {
    mcp = writeMcpJson(cwd);
  } catch (e) {
    console.log(`warning: ${(e as Error).message}`);
  }
  try {
    const rel = execFileSync("git", ["rev-parse", "--git-path", "info/exclude"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const file = isAbsolute(rel) ? rel : join(cwd, rel);
    const have = existsSync(file) ? readFileSync(file, "utf8").split("\n") : [];
    const add = [`${brand.dataDir}/`, ...(mcp === "created" ? [".mcp.json"] : [])].filter((line) => !have.includes(line));
    if (add.length) {
      mkdirSync(join(file, ".."), { recursive: true });
      appendFileSync(file, `${have.length && have[have.length - 1] !== "" ? "\n" : ""}${add.join("\n")}\n`);
    }
  } catch {
    console.log(`warning: not a git repository; threads are kept on branch "no-git" and restore is unavailable.`);
  }
  console.log(`initialised ${brand.dataDir}/${brand.configFile} (port ${port}, user ${config.userName})`);
  console.log(`Run: ${brand.cli} start. The ${brand.name} Chrome extension then works on localhost pages and local files by itself: nothing to add or paste (see README "Use the Chrome extension").`);
  console.log(`Or, without the extension, add this to your dev site:`);
  console.log(`<script src="http://127.0.0.1:${port}/${brand.bundle}"></script>`);
  if (mcp) console.log(`${mcp === "present" ? "kept" : "wrote"} .mcp.json (the Claude Code channel). Then run ${brand.cli} claude: it starts the daemon if needed and Claude Code with comments pushed in. For no open session, run ${brand.cli} start --agent.`);
  install_skill(cwd);
  return 0;
}

function install_skill(cwd: string): void {
  const source = firstExisting(`../../../skills/${brand.cli}/SKILL.md`, `skills/${brand.cli}/SKILL.md`);
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
  install_cursor_rule(cwd, source);
}

// Cursor reads rules from .cursor/rules, not skills. Same text, with Cursor's own frontmatter.
function install_cursor_rule(cwd: string, skill: string): void {
  const target = join(cwd, ".cursor", "rules", `${brand.cli}.mdc`);
  if (existsSync(target)) return;
  const body = readFileSync(skill, "utf8").replace(/^---\n[\s\S]*?\n---\n/, "");
  mkdirSync(join(target, ".."), { recursive: true });
  writeFileSync(target, `---\ndescription: Read ${brand.name} comments from the dev site, make the changes, and reply\nalwaysApply: true\n---\n${body}`);
  console.log(`installed Cursor rule .cursor/rules/${brand.cli}.mdc`);
}

function start(cwd: string, agent = false): Promise<number> {
  const found = findConfig(cwd);
  if (!found) throw new CliError(`no ${brand.cli} project found here; run ${brand.cli} init`);
  const entry = firstExisting("../../daemon/src/interface/main.ts", "daemon.js");
  if (!existsSync(entry)) throw new CliError(`daemon entry not found: ${entry}`);
  return new Promise((res) => {
    const child = spawn("node", [entry, found.dir], { stdio: "inherit" });
    for (const signalName of ["SIGINT", "SIGTERM"] as const) process.on(signalName, () => child.kill(signalName));
    const stop = { done: false };
    // --agent: a headless Claude Code answers each comment, so no session has to be open.
    if (agent) {
      const c = connect(cwd);
      console.log(`${brand.cli} agent: on. Each comment is answered by a headless claude that may edit files in ${found.dir}. Ctrl+C stops it.`);
      void runAgent(() => claim_thread(c, cwd), found.dir, stop);
    }
    child.on("exit", (code) => {
      stop.done = true;
      res(code ?? 0);
    });
  });
}

// Works with the daemon down: it only reads the file the daemon writes.
async function logs(cwd: string, follow: boolean): Promise<number> {
  const found = findConfig(cwd);
  if (!found) throw new CliError(`no ${brand.cli} project found here; run ${brand.cli} init`);
  const file = join(found.dir, brand.dataDir, "daemon.log");
  if (!existsSync(file)) throw new CliError(`no log yet (${file}). The daemon only writes it in dev mode: stop it and run ${brand.envPrefix}DEBUG=1 ${brand.cli} start`);
  console.log(readFileSync(file, "utf8").trimEnd().split("\n").slice(-50).join("\n"));
  if (!follow) return 0;
  let at = statSync(file).size;
  for (;;) {
    await sleep(500);
    const size = statSync(file).size;
    if (size < at) at = 0; // the daemon moved a full file aside
    if (size === at) continue;
    const fd = openSync(file, "r");
    const chunk = Buffer.alloc(size - at);
    readSync(fd, chunk, 0, chunk.length, at);
    closeSync(fd);
    process.stdout.write(chunk);
    at = size;
  }
}

async function claim(c: Client, cwd: string, explain = false): Promise<ClaimNextResponse> {
  const branch = currentBranch(cwd);
  return await c.post<ClaimNextResponse>(paths.claimNext, { agent: c.agent, ...(branch ? { branch } : {}), ...(explain ? { explain: true } : {}) });
}

// Takes every pending thread, oldest first. If a later claim fails, keeps what it already got; the next call retries the rest.
const claim_thread = async (c: Client, cwd: string): Promise<ThreadDto | null> => (await claim(c, cwd)).thread;

// `why` says why nothing came back, and is only asked for on the call the caller will report.
async function claim_all_pending(c: Client, cwd: string, explain = false): Promise<{ got: ThreadDto[]; why?: string }> {
  const got: ThreadDto[] = [];
  try {
    for (;;) {
      const r = await claim(c, cwd, explain);
      if (!r.thread) return { got, why: r.why };
      got.push(r.thread);
    }
  } catch (e) {
    if (!got.length) throw e;
    return { got };
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function runOnce(cmd: string, c: Client, cwd: string, a: Args, listed?: ListThreadsResponse): Promise<number> {
  const [, ...pos] = a.positionals;
  switch (cmd) {
    case "next": {
      const { got, why } = await claim_all_pending(c, cwd, true);
      console.log(got.length ? formatThreads(got) : none_message(why));
      return 0;
    }
    case "wait": {
      const secs = a.values.timeout === undefined ? 60 : Number(a.values.timeout);
      if (!(secs >= 0)) throw new CliError("--timeout must be a number of seconds");
      const deadline = Date.now() + secs * 1000;
      for (;;) {
        const { got, why } = await claim_all_pending(c, cwd, deadline - Date.now() <= 2000);
        if (got.length) {
          console.log(formatThreads(got));
          return 0;
        }
        const left = deadline - Date.now();
        if (left <= 0) {
          console.log(none_message(why));
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
      const r = listed ?? (await c.get<ListThreadsResponse>(paths.threads));
      console.log(`branch: ${r.branch}`);
      const state = agentState(r.agent, Date.now(), brand.cli);
      console.log(`agent: ${r.agent.name ?? "none"} (${state.label})`);
      if (state.kind !== "listening") console.log(state.hint);
      if (r.restoreBlocked) console.log(`restore blocked: ${r.restoreBlocked}`);
      if (!r.threads.length) console.log("no threads");
      for (const t of r.threads) console.log(`#${t.n} ${t.id}  ${statusLabel(t.status)}  ${t.element.selector}`);
      return 0;
    }
    case "history": {
      const id = pos[0];
      const query: Record<string, string> = {};
      if (id) query.threadId = id;
      if (a.values.branch) query.branch = a.values.branch;
      if (a.values.url) query.url = a.values.url;
      const r = await c.get<HistoryResponse>(paths.history, query);
      if (a.values.json) {
        console.log(JSON.stringify(r.events, null, 2));
        return 0;
      }
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
    return await channel(c, () => claim_thread(c, cwd));
  } catch (e) {
    console.error(e instanceof CliError ? e.message : `error: ${(e as Error).message}`);
    return 1;
  }
}

export async function run(argv: string[], cwd: string): Promise<number> {
  try {
    // Everything after `claude` belongs to claude, so it is not parsed here.
    if (argv[0] === "claude") return await claudeCommand(argv.slice(1), cwd);
    const a = parse(argv);
    const cmd = a.positionals[0];
    if (!cmd) throw new CliError(USAGE);
    if (cmd === "extension") {
    console.log(firstExisting("../../extension/dist", "extension"));
    console.log("Load that folder once: chrome://extensions, turn on Developer mode, Load unpacked.");
    return 0;
  }
  if (cmd === "init") return await init(cwd, a);
    if (cmd === "start") {
      // First run in a folder: set it up, then start. No separate init step.
      if (!findConfig(cwd)) {
        const code = await init(cwd, a);
        if (code) return code;
      }
      return await start(cwd, a.values.agent);
    }
    if (cmd === "channel") return await run_channel(cwd, a);
    if (cmd === "doctor") {
      const r = await doctor(cwd);
      console.log(r.text);
      return r.ok ? 0 : 1;
    }
    if (cmd === "logs") return await logs(cwd, a.values.follow === true);
    if (cmd === "resolve") throw new CliError(`only the user closes a thread; ask with: ${brand.cli} reply <id> "<text>" --ask`);
    if (!["next", "wait", "reply", "comment", "ack", "status", "history"].includes(cmd)) throw new CliError(USAGE);
    const c = connect(cwd, a.values.as);
    if (process.env[`${brand.envPrefix}DEBUG`] === "1") console.error(`${brand.cli}: daemon :${c.config.port}, folder ${c.dir}, branch ${currentBranch(cwd) ?? "none"}, agent ${c.agent}`);
    // Asking for notices marks this agent as seen, so `status` reads the list first or it would always report "listening".
    const listed = cmd === "status" ? await c.get<ListThreadsResponse>(paths.threads) : undefined;
    const n = await c.get<NoticesResponse>(paths.notices, { agent: c.agent });
    for (const notice of n.notices) console.log(`${formatNotice(notice)}\n`);
    return await runOnce(cmd, c, cwd, a, listed);
  } catch (e) {
    console.log(e instanceof CliError ? e.message : `error: ${(e as Error).message}`);
    return 1;
  }
}
