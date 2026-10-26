import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { brand } from "../src/brand.ts";
import { ERROR_STATUS, LIMITS } from "../src/api.ts";
import type {
  ElementRef,
  ErrorCode,
  HistoryEvent,
  HistoryEventType,
  ListThreadsResponse,
  MessageDto,
  Notice,
  ThreadDto,
} from "../src/types.ts";

type Json = Record<string, any>;

class HttpError extends Error {
  code: ErrorCode;
  constructor(code: ErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export type StubDaemon = {
  url: string;
  token: string;
  close(): Promise<void>;
  seedNotice(n: Notice): void;
  setBranch(b: string): void;
};

const STALE_MS = 30 * 60_000;

export async function startStubDaemon(opts: { token?: string } = {}): Promise<StubDaemon> {
  const token = opts.token ?? "stub-token";
  let branch = "main";
  const threads: ThreadDto[] = [];
  const events: HistoryEvent[] = [];
  const notices: Notice[] = [];
  const acked = new Set<string>();
  const agents = new Map<string, number>();
  let lastAgent: string | null = null;
  let idCounter = 0;
  const counters = new Map<string, number>();

  const touch = (name: string) => {
    agents.set(name, Date.now());
    lastAgent = name;
  };
  const log = (threadId: string | null, type: HistoryEventType, data: unknown) => {
    events.push({ seq: events.length + 1, threadId, type, at: Date.now(), data });
  };
  const find = (id: string): ThreadDto => {
    const t = threads.find((x) => x.id === id);
    if (!t) throw new HttpError("not_found", `no thread ${id}`);
    return t;
  };
  const str = (v: unknown, name: string): string => {
    if (typeof v !== "string" || v === "") throw new HttpError("invalid", `${name} is required`);
    return v;
  };
  const text = (v: unknown): string => {
    const s = str(v, "text");
    if (s.length > LIMITS.text) throw new HttpError("too_large", "text exceeds 100 KB");
    return s;
  };
  const nextN = (b: string) => {
    const n = (counters.get(b) ?? 0) + 1;
    counters.set(b, n);
    return n;
  };
  const addMessage = (t: ThreadDto, author: string, body: string, ask?: boolean): MessageDto => {
    const m: MessageDto = {
      id: `m${t.messages.length + 1}`,
      author,
      text: body,
      at: Date.now(),
      discarded: false,
    };
    if (ask) m.ask = true;
    t.messages.push(m);
    return m;
  };
  const blank = (b: string, selector: string, tag = "div"): ThreadDto["element"] => ({
    selector,
    tag,
    text: "",
    html: "",
    rect: { x: 0, y: 0, w: 0, h: 0 },
    confidence: "text",
  });

  function route(method: string, path: string, query: URLSearchParams, body: Json): [number, unknown] {
    if (method === "GET" && path === "/health") return [200, { ok: true }];
    if (method === "GET" && path === "/threads") {
      const b = query.get("branch") ?? branch;
      const state = query.get("state");
      const mine = threads.filter((t) => t.branch === b);
      let open = mine.filter((t) => !t.discarded);
      if (state === "open") open = open.filter((t) => t.status !== "resolved");
      if (state === "resolved") open = open.filter((t) => t.status === "resolved");
      const claimed = mine.find((t) => t.status === "received" && !t.discarded);
      const online = lastAgent !== null && Date.now() - (agents.get(lastAgent) ?? 0) < 60_000;
      const res: ListThreadsResponse = {
        branch: b,
        threads: open,
        history: mine.filter((t) => t.discarded),
        agent: { name: lastAgent, online },
        restoreBlocked: claimed ? `thread #${claimed.n} is claimed by ${claimed.agent}` : null,
      };
      return [200, res];
    }
    if (method === "POST" && path === "/threads") {
      const el = body.element as ElementRef | undefined;
      if (!el || typeof el !== "object") throw new HttpError("invalid", "element is required");
      const sel = str(el.selector, "element.selector");
      if (sel.length > LIMITS.selector) throw new HttpError("invalid", "selector too long");
      const msg = text(body.text);
      const t: ThreadDto = {
        id: `t${++idCounter}`,
        n: nextN(branch),
        branch,
        commit: "0000000",
        url: str(body.url, "url"),
        viewport: body.viewport ?? { w: 0, h: 0 },
        element: { ...el, text: String(el.text ?? "").slice(0, LIMITS.elementText), html: String(el.html ?? "").slice(0, LIMITS.html) },
        status: "pending",
        openedBy: "user",
        unread: false,
        discarded: false,
        claimStale: false,
        messages: [],
      };
      addMessage(t, "user", msg);
      threads.push(t);
      log(t.id, "posted", { threadId: t.id });
      return [201, t];
    }
    if (method === "POST" && path === "/threads/agent") {
      const agent = str(body.agent, "agent");
      touch(agent);
      const sel = str(body.selector, "selector");
      if (sel.length > LIMITS.selector) throw new HttpError("invalid", "selector too long");
      const t: ThreadDto = {
        id: `t${++idCounter}`,
        n: nextN(branch),
        branch,
        commit: "0000000",
        url: typeof body.url === "string" ? body.url : "",
        viewport: { w: 0, h: 0 },
        element: blank(branch, sel),
        status: "waiting",
        agent,
        openedBy: "agent",
        unread: true,
        discarded: false,
        claimStale: false,
        messages: [],
      };
      addMessage(t, agent, text(body.text));
      threads.push(t);
      log(t.id, "posted", { threadId: t.id });
      return [201, t];
    }
    if (method === "POST" && path === "/threads/claim-next") {
      const agent = str(body.agent, "agent");
      touch(agent);
      const b = typeof body.branch === "string" && body.branch ? body.branch : branch;
      const now = Date.now();
      for (const t of threads) {
        if (t.branch === b && t.status === "received" && t.claimedAt !== undefined && now - t.claimedAt > STALE_MS) {
          t.status = "pending";
          delete t.agent;
          delete t.claimedAt;
          log(t.id, "requeued", {});
        }
      }
      const t = threads.find((x) => x.branch === b && x.status === "pending" && !x.discarded);
      if (!t) return [200, { thread: null }];
      t.status = "received";
      t.agent = agent;
      t.claimedAt = now;
      log(t.id, "claimed", { thread: structuredClone(t) });
      return [200, { thread: t }];
    }
    const m = /^\/threads\/([^/]+)\/(messages|resolve|reopen|release|read)$/.exec(path);
    if (method === "POST" && m) {
      const t = find(decodeURIComponent(m[1]!));
      const action = m[2];
      if (action === "messages") {
        const author = str(body.author, "author");
        const msg = text(body.text);
        if (author === "user") {
          addMessage(t, "user", msg);
          t.status = "pending";
          delete t.agent;
          delete t.claimedAt;
        } else {
          touch(author);
          addMessage(t, author, msg, body.ask === true);
          t.unread = true;
          if (body.ask === true) t.status = "waiting";
        }
        log(t.id, "replied", { author });
      } else if (action === "resolve") {
        if (t.status === "resolved") throw new HttpError("not_pending", "already resolved");
        if (body.by !== "user" && body.by !== "agent") throw new HttpError("invalid", "by must be user or agent");
        if (body.by === "agent") {
          if (t.status === "waiting") throw new HttpError("waiting_on_user", "waiting on the user's reply");
          if (typeof body.agent === "string") touch(body.agent);
        }
        t.status = "resolved";
        log(t.id, "resolved", { by: body.by });
      } else if (action === "reopen") {
        if (t.status !== "resolved") throw new HttpError("not_pending", "thread is not resolved");
        t.status = "pending";
        delete t.agent;
        delete t.claimedAt;
        log(t.id, "reopened", {});
      } else if (action === "release") {
        if (t.status !== "received") throw new HttpError("not_pending", "thread is not claimed");
        t.status = "pending";
        delete t.agent;
        delete t.claimedAt;
        log(t.id, "released", {});
      } else {
        t.unread = false;
      }
      return [200, t];
    }
    if (method === "POST" && path === "/restore") {
      str(body.threadId, "threadId");
      str(body.messageId, "messageId");
      return [200, { restoredTo: body.messageId, discardedMessageIds: [], discardedThreadIds: [], changedFiles: [], safetyCheckpointId: "stub-safety" }];
    }
    if (method === "GET" && path === "/notices") {
      const agent = str(query.get("agent"), "agent");
      touch(agent);
      return [200, { notices: notices.filter((n) => !acked.has(`${agent}:${n.id}`)) }];
    }
    const ack = /^\/agents\/([^/]+)\/ack$/.exec(path);
    if (method === "POST" && ack) {
      const name = decodeURIComponent(ack[1]!);
      for (const n of notices) acked.add(`${name}:${n.id}`);
      return [200, { ok: true }];
    }
    if (method === "GET" && path === "/history") {
      const id = query.get("threadId");
      return [200, { events: id ? events.filter((e) => e.threadId === id) : events }];
    }
    throw new HttpError("not_found", `no route ${method} ${path}`);
  }

  function send(res: ServerResponse, status: number, body: unknown, type = "application/json") {
    res.writeHead(status, {
      "content-type": type,
      "access-control-allow-origin": "*",
      "access-control-allow-headers": `content-type, ${brand.tokenHeader}`,
      "access-control-allow-methods": "GET, POST, OPTIONS",
    });
    res.end(typeof body === "string" ? body : JSON.stringify(body));
  }

  async function readBody(req: IncomingMessage): Promise<string> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const c of req) {
      size += (c as Buffer).length;
      if (size > LIMITS.body) throw new HttpError("too_large", "request body exceeds 2 MB");
      chunks.push(c as Buffer);
    }
    return Buffer.concat(chunks).toString("utf8");
  }

  const server = createServer(async (req, res) => {
    try {
      const u = new URL(req.url ?? "/", "http://stub");
      if (req.method === "OPTIONS") return send(res, 204, "");
      const open = u.pathname === "/health" || u.pathname === `/${brand.bundle}`;
      if (!open && req.headers[brand.tokenHeader] !== token) {
        throw new HttpError("unauthorized", "missing or wrong token");
      }
      if (u.pathname === `/${brand.bundle}`) {
        const base = `http://${req.headers.host}`;
        return send(res, 200, `globalThis[${JSON.stringify(brand.configGlobal)}] = ${JSON.stringify({ base, token })};\n`, "text/javascript");
      }
      let body: Json = {};
      if (req.method === "POST") {
        const raw = await readBody(req);
        if (raw) {
          try {
            body = JSON.parse(raw);
          } catch {
            throw new HttpError("invalid", "body is not valid JSON");
          }
        }
      }
      const [status, reply_body] = route(req.method ?? "GET", u.pathname, u.searchParams, body);
      send(res, status, reply_body);
    } catch (e) {
      if (e instanceof HttpError) {
        send(res, ERROR_STATUS[e.code], { error: e.code, message: e.message });
      } else {
        send(res, 500, { error: "internal", message: String(e) });
      }
    }
  });

  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address() as { port: number };
  return {
    url: `http://127.0.0.1:${addr.port}`,
    token,
    seedNotice: (n) => void notices.push(n),
    setBranch: (b) => void (branch = b),
    close: () =>
      new Promise<void>((r) => {
        server.closeAllConnections();
        server.close(() => r());
      }),
  };
}
