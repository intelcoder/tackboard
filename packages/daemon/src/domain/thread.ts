import type { ElementRef, HistoryEventType, MessageDto, ThreadDto, ThreadStatus } from "@app/shared";
import { DomainError } from "./errors.ts";
import type { AgentName, Branch, CommitSha } from "./value_objects.ts";

const STALE_CLAIM_MS = 30 * 60_000;

export type DomainEvent = { type: HistoryEventType; at: number; data: unknown };

type Message = MessageDto & { seq: number };

/** Plain snapshot of a Thread's persisted fields, used by repositories to rehydrate without re-running invariants. */
export type ThreadState = {
  id: string;
  n: number;
  branch: string;
  commit: string;
  url: string;
  viewport: { w: number; h: number };
  element: ElementRef;
  openedBy: "user" | "agent";
  status: ThreadStatus;
  agent?: string;
  unread: boolean;
  claimedAt?: number;
  messages: Array<MessageDto & { seq: number }>;
};

type OpenArgs = {
  id: string;
  n: number;
  branch: Branch;
  commit: CommitSha;
  url: string;
  viewport: { w: number; h: number };
  element: ElementRef;
  text: string;
  now: number;
  seq: number;
};

type OpenByAgentArgs = Omit<OpenArgs, "viewport" | "text"> & {
  agent: AgentName;
  text: string;
  viewport?: { w: number; h: number };
};

export class Thread {
  readonly id: string;
  readonly n: number;
  readonly branch: string;
  readonly commit: string;
  readonly url: string;
  readonly viewport: { w: number; h: number };
  readonly element: ElementRef;
  readonly openedBy: "user" | "agent";
  private _status: ThreadStatus;
  private _agent: string | undefined;
  private _unread: boolean;
  private _claimedAt: number | undefined;
  private _messages: Message[] = [];
  private events: DomainEvent[] = [];

  private constructor(a: {
    id: string; n: number; branch: string; commit: string; url: string;
    viewport: { w: number; h: number }; element: ElementRef; openedBy: "user" | "agent";
    status: ThreadStatus; agent?: string; unread: boolean;
  }) {
    this.id = a.id;
    this.n = a.n;
    this.branch = a.branch;
    this.commit = a.commit;
    this.url = a.url;
    this.viewport = a.viewport;
    this.element = a.element;
    this.openedBy = a.openedBy;
    this._status = a.status;
    this._agent = a.agent;
    this._unread = a.unread;
  }

  static open(a: OpenArgs): Thread {
    const t = new Thread({
      id: a.id, n: a.n, branch: a.branch.value, commit: a.commit.value, url: a.url,
      viewport: a.viewport, element: a.element, openedBy: "user", status: "pending", unread: false,
    });
    t.push("user", a.text, a.now, a.seq);
    t.record("posted", a.now, { thread: t.toDto(a.now) });
    return t;
  }

  static openByAgent(a: OpenByAgentArgs): Thread {
    const t = new Thread({
      id: a.id, n: a.n, branch: a.branch.value, commit: a.commit.value, url: a.url,
      viewport: a.viewport ?? { w: 0, h: 0 }, element: a.element, openedBy: "agent",
      status: "waiting", agent: a.agent.value, unread: true,
    });
    t.push(a.agent.value, a.text, a.now, a.seq, true);
    t.record("posted", a.now, { thread: t.toDto(a.now) });
    return t;
  }

  /** Rehydrate from persisted state. Runs no invariants and records no events. */
  static fromState(state: ThreadState): Thread {
    const copy = structuredClone(state);
    const t = new Thread({
      id: copy.id, n: copy.n, branch: copy.branch, commit: copy.commit, url: copy.url,
      viewport: copy.viewport, element: copy.element, openedBy: copy.openedBy,
      status: copy.status, agent: copy.agent, unread: copy.unread,
    });
    t._claimedAt = copy.claimedAt;
    t._messages = copy.messages;
    return t;
  }

  toState(): ThreadState {
    const s: ThreadState = {
      id: this.id, n: this.n, branch: this.branch, commit: this.commit, url: this.url,
      viewport: this.viewport, element: this.element, openedBy: this.openedBy,
      status: this._status, unread: this._unread, messages: this._messages,
    };
    if (this._agent !== undefined) s.agent = this._agent;
    if (this._claimedAt !== undefined) s.claimedAt = this._claimedAt;
    return structuredClone(s);
  }

  get status(): ThreadStatus { return this._status; }
  get agent(): string | undefined { return this._agent; }
  get messages(): readonly MessageDto[] { return this._messages; }
  get discarded(): boolean { return this._messages[0]?.discarded === true; }

  claim(agent: AgentName, now: number): void {
    if (this._status !== "pending") throw new DomainError("not_pending", `thread ${this.n} is ${this._status}, not pending`);
    this._status = "received";
    this._agent = agent.value;
    this._claimedAt = now;
    this.record("claimed", now, { thread: this.toDto(now) });
  }

  reply(author: string, text: string, now: number, seq: number, opts: { ask?: boolean } = {}): void {
    if (author === "user") {
      this.push("user", text, now, seq);
      this._status = "pending";
      this._agent = undefined;
      this._claimedAt = undefined;
    } else {
      this.push(author, text, now, seq, opts.ask);
      this._unread = true;
      if (opts.ask) this._status = "waiting";
    }
    this.record("replied", now, { messageId: this._messages[this._messages.length - 1]!.id, author });
  }

  resolve(by: "user" | "agent", now: number = Date.now()): void {
    if (this._status === "resolved") throw new DomainError("invalid", `thread ${this.n} is already resolved`);
    this._status = "resolved";
    this._claimedAt = undefined;
    this.record("resolved", now, { by });
  }

  release(now: number = Date.now()): void {
    if (this._status !== "received") throw new DomainError("invalid", `thread ${this.n} is not claimed`);
    this.unclaim();
    this.record("released", now, {});
  }

  reopen(now: number = Date.now()): void {
    if (this._status !== "resolved") throw new DomainError("invalid", `thread ${this.n} is not resolved`);
    this._status = "pending";
    this._agent = undefined;
    this.record("reopened", now, {});
  }

  markRead(): void {
    this._unread = false;
  }

  isStaleClaim(now: number): boolean {
    return this._status === "received" && this._claimedAt !== undefined && now - this._claimedAt > STALE_CLAIM_MS;
  }

  requeueIfStale(now: number): boolean {
    if (!this.isStaleClaim(now)) return false;
    this.unclaim();
    this.record("requeued", now, {});
    return true;
  }

  discardAfterSeq(seq: number): string[] {
    const ids: string[] = [];
    for (const m of this._messages) {
      if (m.seq > seq && !m.discarded) {
        m.discarded = true;
        ids.push(m.id);
      }
    }
    return ids;
  }

  attachCheckpoint(messageId: string, checkpointId: string): void {
    const m = this._messages.find((x) => x.id === messageId);
    if (!m) throw new DomainError("not_found", `message ${messageId} not found`);
    m.checkpointId = checkpointId;
  }

  addSystemMessage(text: string, now: number, seq: number, checkpointId: string): void {
    this.push("system", text, now, seq);
    this._messages[this._messages.length - 1]!.checkpointId = checkpointId;
  }

  /** Adds the "Restored to message" note (carrying the safety checkpoint) and records the one `restored` event. */
  noteRestore(messageId: string, safetyCheckpointId: string, now: number, seq: number, data: unknown): void {
    // The number is the place among the messages the user still sees, as the confirm and the toast count them.
    const shown = this._messages.filter((m) => !m.discarded);
    const number = shown.findIndex((m) => m.id === messageId) + 1;
    this.addSystemMessage(`Restored to message ${number}`, now, seq, safetyCheckpointId);
    this.record("restored", now, data);
  }

  pullEvents(): DomainEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }

  static restoreBlocker(threads: Thread[], now: number): string | null {
    const t = threads.find((x) => x._status === "received" && !x.discarded && !x.isStaleClaim(now));
    return t ? `Thread #${t.n} is claimed by ${t._agent ?? "an agent"}; wait for it to finish or release it.` : null;
  }

  toDto(now: number): ThreadDto {
    const dto: ThreadDto = {
      id: this.id, n: this.n, branch: this.branch, commit: this.commit, url: this.url,
      viewport: this.viewport, element: this.element, status: this._status,
      openedBy: this.openedBy, unread: this._unread, discarded: this.discarded,
      claimStale: this.isStaleClaim(now),
      messages: this._messages.map(({ seq: _seq, ...m }) => ({ ...m })),
    };
    if (this._agent !== undefined) dto.agent = this._agent;
    if (this._claimedAt !== undefined) dto.claimedAt = this._claimedAt;
    return dto;
  }

  private unclaim(): void {
    this._status = "pending";
    this._agent = undefined;
    this._claimedAt = undefined;
  }

  private push(author: string, text: string, at: number, seq: number, ask?: boolean): void {
    const m: Message = { id: `m${this._messages.length + 1}`, author, text, at, discarded: false, seq };
    if (ask) m.ask = true;
    this._messages.push(m);
  }

  private record(type: HistoryEventType, at: number, data: unknown): void {
    this.events.push({ type, at, data });
  }
}
