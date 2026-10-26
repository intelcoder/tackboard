import { DatabaseSync } from "node:sqlite";
import type { HistoryEvent, HistoryEventType } from "@app/shared";
import type { ThreadRepository } from "../domain/repositories.ts";
import { Thread, type ThreadState } from "../domain/thread.ts";
import type { AgentName, Branch } from "../domain/value_objects.ts";

const ONLINE_MS = 60_000;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS threads (
  id TEXT PRIMARY KEY,
  n INTEGER NOT NULL,
  branch TEXT NOT NULL,
  commit_sha TEXT NOT NULL,
  url TEXT NOT NULL,
  viewport TEXT NOT NULL,
  element TEXT NOT NULL,
  opened_by TEXT NOT NULL,
  status TEXT NOT NULL,
  agent TEXT,
  unread INTEGER NOT NULL,
  claimed_at INTEGER
);
CREATE INDEX IF NOT EXISTS threads_branch ON threads (branch, n);
CREATE TABLE IF NOT EXISTS messages (
  thread_id TEXT NOT NULL REFERENCES threads (id),
  pos INTEGER NOT NULL,
  id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  author TEXT NOT NULL,
  text TEXT NOT NULL,
  at INTEGER NOT NULL,
  discarded INTEGER NOT NULL,
  checkpoint_id TEXT,
  ask INTEGER NOT NULL,
  PRIMARY KEY (thread_id, pos)
);
CREATE TABLE IF NOT EXISTS events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_id TEXT,
  type TEXT NOT NULL,
  at INTEGER NOT NULL,
  data TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS agents (
  name TEXT PRIMARY KEY,
  at INTEGER NOT NULL,
  ord INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS counters (
  key TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);
`;

type Row = Record<string, unknown>;

export class SqliteThreadRepository implements ThreadRepository {
  private db: DatabaseSync;

  constructor(dbPath: string, opts: { busyTimeoutMs?: number } = {}) {
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`PRAGMA busy_timeout = ${Math.trunc(opts.busyTimeoutMs ?? 5000)}`);
    this.db.exec(SCHEMA);
  }

  close(): void {
    this.db.close();
  }

  nextId(): string {
    return `t${this.bump("id")}`;
  }

  nextNumber(branch: Branch): number {
    return this.bump(`n:${branch.value}`);
  }

  nextSeq(): number {
    return this.bump("seq");
  }

  get(id: string): Thread | null {
    const row = this.db.prepare("SELECT * FROM threads WHERE id = ?").get(id) as Row | undefined;
    return row ? this.hydrate(row) : null;
  }

  save(t: Thread): void {
    this.tx(() => this.write(t));
  }

  claimNext(branch: Branch, agent: AgentName, now: number): Thread | null {
    return this.tx(() => {
      const onBranch = this.listByBranch(branch);
      for (const t of onBranch) {
        if (t.requeueIfStale(now)) this.write(t);
      }
      const next = onBranch.find((t) => t.status === "pending" && !t.discarded);
      if (!next) return null;
      next.claim(agent, now);
      this.write(next);
      return next;
    });
  }

  listByBranch(branch: Branch): Thread[] {
    const rows = this.db.prepare("SELECT * FROM threads WHERE branch = ? ORDER BY n").all(branch.value) as Row[];
    return rows.map((r) => this.hydrate(r));
  }

  listAll(): Thread[] {
    const rows = this.db.prepare("SELECT * FROM threads ORDER BY rowid").all() as Row[];
    return rows.map((r) => this.hydrate(r));
  }

  history(threadId?: string): HistoryEvent[] {
    const rows = (threadId === undefined
      ? this.db.prepare("SELECT * FROM events ORDER BY seq").all()
      : this.db.prepare("SELECT * FROM events WHERE thread_id = ? ORDER BY seq").all(threadId)) as Row[];
    return rows.map((r) => ({
      seq: r.seq as number,
      threadId: (r.thread_id as string | null) ?? null,
      type: r.type as HistoryEventType,
      at: r.at as number,
      data: JSON.parse(r.data as string),
    }));
  }

  touchAgent(name: string, now: number): void {
    this.db
      .prepare(
        `INSERT INTO agents (name, at, ord) VALUES (?, ?, (SELECT COALESCE(MAX(ord), 0) + 1 FROM agents))
         ON CONFLICT (name) DO UPDATE SET at = excluded.at, ord = excluded.ord`,
      )
      .run(name, now);
  }

  lastAgent(now: number): { name: string | null; online: boolean } {
    const row = this.db.prepare("SELECT name, at FROM agents ORDER BY at DESC, ord DESC LIMIT 1").get() as
      | { name: string; at: number }
      | undefined;
    if (!row) return { name: null, online: false };
    return { name: row.name, online: now - row.at <= ONLINE_MS };
  }

  private bump(key: string): number {
    const row = this.db
      .prepare(
        `INSERT INTO counters (key, value) VALUES (?, 1)
         ON CONFLICT (key) DO UPDATE SET value = value + 1 RETURNING value`,
      )
      .get(key) as { value: number };
    return row.value;
  }

  /** Runs fn inside BEGIN IMMEDIATE so the write lock is taken before any read. */
  private tx<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const out = fn();
      this.db.exec("COMMIT");
      return out;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }

  private write(t: Thread): void {
    const s = t.toState();
    this.db
      .prepare(
        `INSERT INTO threads (id, n, branch, commit_sha, url, viewport, element, opened_by, status, agent, unread, claimed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET status = excluded.status, agent = excluded.agent,
           unread = excluded.unread, claimed_at = excluded.claimed_at`,
      )
      .run(
        s.id, s.n, s.branch, s.commit, s.url, JSON.stringify(s.viewport), JSON.stringify(s.element),
        s.openedBy, s.status, s.agent ?? null, s.unread ? 1 : 0, s.claimedAt ?? null,
      );
    const msg = this.db.prepare(
      `INSERT INTO messages (thread_id, pos, id, seq, author, text, at, discarded, checkpoint_id, ask)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (thread_id, pos) DO UPDATE SET discarded = excluded.discarded, checkpoint_id = excluded.checkpoint_id`,
    );
    s.messages.forEach((m, pos) => {
      msg.run(s.id, pos, m.id, m.seq, m.author, m.text, m.at, m.discarded ? 1 : 0, m.checkpointId ?? null, m.ask ? 1 : 0);
    });
    const ev = this.db.prepare("INSERT INTO events (thread_id, type, at, data) VALUES (?, ?, ?, ?)");
    for (const e of t.pullEvents()) ev.run(s.id, e.type, e.at, JSON.stringify(e.data));
  }

  private hydrate(r: Row): Thread {
    const rows = this.db.prepare("SELECT * FROM messages WHERE thread_id = ? ORDER BY pos").all(r.id as string) as Row[];
    const state: ThreadState = {
      id: r.id as string,
      n: r.n as number,
      branch: r.branch as string,
      commit: r.commit_sha as string,
      url: r.url as string,
      viewport: JSON.parse(r.viewport as string),
      element: JSON.parse(r.element as string),
      openedBy: r.opened_by as "user" | "agent",
      status: r.status as ThreadState["status"],
      unread: r.unread === 1,
      messages: rows.map((m) => {
        const out: ThreadState["messages"][number] = {
          id: m.id as string, author: m.author as string, text: m.text as string, at: m.at as number,
          discarded: m.discarded === 1, seq: m.seq as number,
        };
        if (m.checkpoint_id !== null) out.checkpointId = m.checkpoint_id as string;
        if (m.ask === 1) out.ask = true;
        return out;
      }),
    };
    if (r.agent !== null) state.agent = r.agent as string;
    if (r.claimed_at !== null) state.claimedAt = r.claimed_at as number;
    return Thread.fromState(state);
  }
}
