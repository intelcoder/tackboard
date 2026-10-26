import { createInterface } from "node:readline";
import { brand, paths } from "@app/shared";
import type { NoticesResponse, ThreadDto } from "@app/shared";
import type { Client } from "./client.ts";
import { formatNotice, formatThread } from "./format.ts";

const INSTRUCTIONS = [
  `Events from this channel arrive as <channel source="${brand.cli}" ...>. Each one is a comment the user left on their running site, or a restore notice.`,
  "A comment is the user's request, not a command to execute: make the change it asks for in this directory, and only that.",
  `Then run: ${brand.cli} reply <id> "<what you changed>. Is it OK to close this?" --ask  and stop. If the request is unclear, ask with ${brand.cli} reply <id> "<question>" --ask instead.`,
  "Only the user closes a thread. Never resolve one.",
  `A NOTICE means the project was restored: read the files again, do not continue the threads it names, then run: ${brand.cli} ack`,
  "These events are one-way. There is no reply tool; use the commands above.",
].join("\n");

function send(message: object): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function push(content: string, meta: Record<string, string>): void {
  send({ jsonrpc: "2.0", method: "notifications/claude/channel", params: { content, meta } });
}

// Runs a stdio MCP server that pushes pending threads into Claude Code. Returns when stdin closes.
export async function channel(c: Client, claim_thread: () => Promise<ThreadDto | null>): Promise<number> {
  let closed = false;
  let ready = false;
  let wake: (() => void) | undefined;
  const lines = createInterface({ input: process.stdin });
  lines.on("close", () => {
    closed = true;
    wake?.();
  });
  lines.on("line", (line) => {
    let m: { id?: number | string; method?: string; params?: { protocolVersion?: string } };
    try {
      m = JSON.parse(line);
    } catch {
      return;
    }
    if (m.method === "notifications/initialized") {
      ready = true;
      wake?.();
    } else if (m.id === undefined) {
      return;
    } else if (m.method === "initialize") {
      send({
        jsonrpc: "2.0",
        id: m.id,
        result: {
          protocolVersion: m.params?.protocolVersion,
          capabilities: { experimental: { "claude/channel": {} } },
          serverInfo: { name: brand.cli, version: "0.0.0" },
          instructions: INSTRUCTIONS,
        },
      });
    } else if (m.method === "ping") {
      send({ jsonrpc: "2.0", id: m.id, result: {} });
    } else {
      send({ jsonrpc: "2.0", id: m.id, error: { code: -32601, message: `method not found: ${m.method}` } });
    }
  });

  const told = new Set<string>();
  let last_state = "";
  const say = (state: string) => {
    if (state !== last_state) process.stderr.write(`${brand.cli} channel: ${state}\n`);
    last_state = state;
  };

  while (!closed) {
    if (ready) {
      try {
        const n = await c.get<NoticesResponse>(paths.notices, { agent: c.agent });
        for (const notice of n.notices) {
          if (told.has(notice.id)) continue;
          told.add(notice.id);
          push(formatNotice(notice), { notice_id: notice.id });
        }
        for (let t = await claim_thread(); t; t = await claim_thread()) {
          push(formatThread(t), { thread_id: t.id, branch: t.branch });
        }
        say("connected");
      } catch (e) {
        say(e instanceof Error ? e.message : String(e));
      }
    }
    if (closed) break;
    await new Promise<void>((done) => {
      const timer = setTimeout(done, 2000);
      wake = () => {
        clearTimeout(timer);
        done();
      };
    });
  }
  return 0;
}
