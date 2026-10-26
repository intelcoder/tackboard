import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import type { ServerType } from "@hono/node-server";
import { brand, ERROR_STATUS, LIMITS, paths } from "@app/shared";
import type { ElementRef } from "@app/shared";
import { DomainError } from "../domain/errors.ts";
import type { Clock } from "../domain/repositories.ts";
import { SystemClock } from "../infrastructure/clock.ts";
import { GitCheckpointStore } from "../infrastructure/git_checkpoint_store.ts";
import { GitInfoReader } from "../infrastructure/git_info.ts";
import { SqliteThreadRepository } from "../infrastructure/sqlite_thread_repository.ts";
import { PostCommentHandler } from "../application/commands/post_comment.ts";
import { PostAgentCommentHandler } from "../application/commands/post_agent_comment.ts";
import { ClaimNextThreadHandler } from "../application/commands/claim_next_thread.ts";
import { ReplyToThreadHandler } from "../application/commands/reply_to_thread.ts";
import { ResolveThreadHandler } from "../application/commands/resolve_thread.ts";
import { ReopenThreadHandler } from "../application/commands/reopen_thread.ts";
import { ReleaseThreadHandler } from "../application/commands/release_thread.ts";
import { MarkReadHandler } from "../application/commands/mark_read.ts";
import { RestoreToMessageHandler } from "../application/commands/restore_to_message.ts";
import { AckNoticesHandler } from "../application/commands/ack_notices.ts";
import { ListThreadsHandler } from "../application/queries/list_threads.ts";
import { GetHistoryHandler } from "../application/queries/get_history.ts";
import { GetNoticesHandler } from "../application/queries/get_notices.ts";
import { security } from "./security.ts";

export type DaemonOptions = {
  projectDir: string;
  port: number;
  allowedOrigins: string[];
  token: string;
  clock?: Clock;
  bundlePath?: string;
};

export type Daemon = {
  listen(): Promise<number>;
  address(): { address: string; port: number } | null;
  close(): Promise<void>;
};

type Body = Record<string, unknown>;
type Variables = { body: Body };

const default_bundle = join(import.meta.dirname, "..", "..", "..", "overlay", "dist", brand.bundle);

function need_text(value: unknown, name: string): string {
  if (typeof value !== "string" || value === "") throw new DomainError("invalid", `${name} is required`);
  return value;
}

function need_selector(value: unknown, name: string): string {
  const selector = need_text(value, name);
  if (selector.length > LIMITS.selector) throw new DomainError("invalid", `${name} is longer than ${LIMITS.selector} characters`);
  return selector;
}

function read_element(value: unknown): ElementRef {
  if (typeof value !== "object" || value === null) throw new DomainError("invalid", "element is required");
  const e = value as Partial<ElementRef>;
  const rect = e.rect;
  if (typeof rect !== "object" || rect === null) throw new DomainError("invalid", "element.rect is required");
  return {
    ...e,
    selector: need_selector(e.selector, "element.selector"),
    tag: typeof e.tag === "string" ? e.tag : "",
    text: typeof e.text === "string" ? e.text : "",
    html: typeof e.html === "string" ? e.html : "",
    rect,
    confidence: e.confidence === "source" || e.confidence === "component" ? e.confidence : "text",
  };
}

function read_viewport(value: unknown): { w: number; h: number } {
  const v = value as { w?: unknown; h?: unknown } | null | undefined;
  if (typeof v !== "object" || v === null || typeof v.w !== "number" || typeof v.h !== "number") {
    throw new DomainError("invalid", "viewport needs numbers w and h");
  }
  return { w: v.w, h: v.h };
}

export function createDaemon(opts: DaemonOptions): Daemon {
  const dataDir = join(opts.projectDir, brand.dataDir);
  mkdirSync(dataDir, { recursive: true });
  const repo = new SqliteThreadRepository(join(dataDir, brand.dbFile));
  const clock = opts.clock ?? new SystemClock();
  const git = new GitInfoReader(opts.projectDir);
  const checkpoints = new GitCheckpointStore(opts.projectDir);

  const post_comment = new PostCommentHandler(repo, clock, git);
  const post_agent_comment = new PostAgentCommentHandler(repo, clock, git);
  const claim_next = new ClaimNextThreadHandler(repo, clock, git, checkpoints);
  const reply = new ReplyToThreadHandler(repo, clock, checkpoints);
  const resolve = new ResolveThreadHandler(repo, clock, checkpoints);
  const reopen = new ReopenThreadHandler(repo, clock);
  const release = new ReleaseThreadHandler(repo, clock);
  const mark_read = new MarkReadHandler(repo, clock);
  const restore = new RestoreToMessageHandler(repo, clock, git, checkpoints);
  const ack = new AckNoticesHandler(repo);
  const list_threads = new ListThreadsHandler(repo, clock, git);
  const get_history = new GetHistoryHandler(repo);
  const get_notices = new GetNoticesHandler(repo, clock);

  let server: ServerType | null = null;
  const address = () => {
    const a = server?.address();
    return a !== null && a !== undefined && typeof a === "object" ? { address: a.address, port: a.port } : null;
  };

  const app = new Hono<{ Variables: Variables }>();
  app.use("*", security({ allowedOrigins: opts.allowedOrigins, token: opts.token, port: () => address()?.port ?? opts.port }));

  app.onError((e, c) => {
    if (e instanceof DomainError) return c.json({ error: e.code, message: e.message }, ERROR_STATUS[e.code] as 400);
    return c.json({ error: "internal", message: "something went wrong inside the daemon" }, 500);
  });
  app.notFound((c) => c.json({ error: "not_found", message: `no route ${c.req.method} ${c.req.path}` }, 404));

  app.get(paths.health, (c) => c.json({ ok: true }));

  app.get(`/${brand.bundle}`, (c) => {
    let bundle: string;
    try {
      bundle = readFileSync(opts.bundlePath ?? default_bundle, "utf8");
    } catch {
      throw new DomainError("not_found", "the overlay bundle has not been built");
    }
    const base = `http://127.0.0.1:${address()?.port ?? opts.port}`;
    const first_line = `globalThis[${JSON.stringify(brand.configGlobal)}]=${JSON.stringify({ base, token: opts.token })};\n`;
    return c.body(first_line + bundle, 200, { "content-type": "text/javascript; charset=utf-8" });
  });

  app.get(paths.threads, (c) => {
    const state = c.req.query("state");
    if (state !== undefined && state !== "open" && state !== "resolved") throw new DomainError("invalid", "state must be open or resolved");
    return c.json(list_threads.handle({ branch: c.req.query("branch") || undefined, state }));
  });

  app.post(paths.threads, (c) => {
    const b = c.get("body");
    const thread = post_comment.handle({
      element: read_element(b.element),
      url: need_text(b.url, "url"),
      viewport: read_viewport(b.viewport),
      text: need_text(b.text, "text"),
    });
    return c.json(thread, 201);
  });

  app.post(paths.agentThread, (c) => {
    const b = c.get("body");
    const thread = post_agent_comment.handle({
      agent: need_text(b.agent, "agent"),
      selector: need_selector(b.selector, "selector"),
      text: need_text(b.text, "text"),
      url: typeof b.url === "string" ? b.url : undefined,
    });
    return c.json(thread, 201);
  });

  app.post(paths.claimNext, (c) => {
    const b = c.get("body");
    const thread = claim_next.handle({
      agent: need_text(b.agent, "agent"),
      branch: typeof b.branch === "string" && b.branch !== "" ? b.branch : undefined,
    });
    return c.json({ thread });
  });

  app.post("/threads/:id/messages", (c) => {
    const b = c.get("body");
    const thread = reply.handle({
      id: c.req.param("id"),
      author: need_text(b.author, "author"),
      text: need_text(b.text, "text"),
      ask: b.ask === true,
    });
    return c.json(thread);
  });

  app.post("/threads/:id/resolve", (c) => {
    const b = c.get("body");
    if (b.by !== "user" && b.by !== "agent") throw new DomainError("invalid", "by must be user or agent");
    return c.json(resolve.handle({ id: c.req.param("id"), by: b.by }));
  });

  app.post("/threads/:id/reopen", (c) => c.json(reopen.handle({ id: c.req.param("id") })));
  app.post("/threads/:id/release", (c) => c.json(release.handle({ id: c.req.param("id") })));
  app.post("/threads/:id/read", (c) => c.json(mark_read.handle({ id: c.req.param("id") })));

  app.post(paths.restore, (c) => {
    const b = c.get("body");
    return c.json(restore.handle({ threadId: need_text(b.threadId, "threadId"), messageId: need_text(b.messageId, "messageId") }));
  });

  app.get(paths.notices, (c) => c.json({ notices: get_notices.handle({ agent: c.req.query("agent") ?? "" }) }));

  app.post("/agents/:name/ack", (c) => {
    ack.handle({ agent: c.req.param("name") });
    return c.json({ ok: true });
  });

  app.get(paths.history, (c) => c.json({ events: get_history.handle({ threadId: c.req.query("threadId") || undefined }) }));

  return {
    listen: () =>
      new Promise<number>((resolve_port, reject) => {
        server = serve({ fetch: app.fetch, port: opts.port, hostname: "127.0.0.1" }, (info) => resolve_port(info.port));
        server.once("error", reject);
      }),
    address,
    close: () =>
      new Promise<void>((done) => {
        const finish = () => {
          repo.close();
          done();
        };
        if (!server) return finish();
        server.close(finish);
        if ("closeAllConnections" in server) server.closeAllConnections();
      }),
  };
}
