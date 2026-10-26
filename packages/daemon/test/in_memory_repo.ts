import type { HistoryEvent, Notice } from "@app/shared";
import type { ThreadRepository } from "../src/domain/repositories.ts";
import { Thread, type ThreadState } from "../src/domain/thread.ts";
import type { AgentName, Branch } from "../src/domain/value_objects.ts";

const ONLINE_MS = 60_000;

export class InMemoryThreadRepository implements ThreadRepository {
  // Threads are kept as plain state and rebuilt on every get, like a real database would.
  private threads = new Map<string, ThreadState>();
  private events: HistoryEvent[] = [];
  private idCounter = 0;
  private seqCounter = 0;
  private numbers = new Map<string, number>();
  private agents = new Map<string, { at: number; firstSeen: number }>();
  private notices: Notice[] = [];
  private acked = new Set<string>();

  nextId(): string {
    return `t${++this.idCounter}`;
  }

  nextNumber(branch: Branch): number {
    const n = (this.numbers.get(branch.value) ?? 0) + 1;
    this.numbers.set(branch.value, n);
    return n;
  }

  nextSeq(): number {
    return ++this.seqCounter;
  }

  get(id: string): Thread | null {
    const state = this.threads.get(id);
    return state ? Thread.fromState(state) : null;
  }

  save(t: Thread): void {
    this.threads.set(t.id, t.toState());
    for (const e of t.pullEvents()) {
      this.events.push({ seq: this.events.length + 1, threadId: t.id, type: e.type, at: e.at, data: e.data });
    }
  }

  claimNext(branch: Branch, agent: AgentName, now: number): Thread | null {
    const onBranch = this.listByBranch(branch);
    for (const t of onBranch) {
      if (t.requeueIfStale(now)) this.save(t);
    }
    const next = onBranch.find((t) => t.status === "pending" && !t.discarded);
    if (!next) return null;
    next.claim(agent, now);
    this.save(next);
    return next;
  }

  listByBranch(branch: Branch): Thread[] {
    return this.listAll().filter((t) => t.branch === branch.value).sort((a, b) => a.n - b.n);
  }

  listAll(): Thread[] {
    return [...this.threads.values()].map((state) => Thread.fromState(state));
  }

  saveRestore(threads: Thread[], notice: Notice): void {
    if (this.notices.some((n) => n.id === notice.id)) throw new Error(`notice ${notice.id} already exists`);
    for (const t of threads) this.save(t);
    this.notices.push(notice);
  }

  add(n: Notice): void {
    if (this.notices.some((x) => x.id === n.id)) throw new Error(`notice ${n.id} already exists`);
    this.notices.push(n);
  }

  pendingFor(agent: string): Notice[] {
    const seen = this.agents.get(agent);
    if (!seen) return [];
    return this.notices.filter((n) => n.at > seen.firstSeen && !this.acked.has(`${agent}\n${n.id}`));
  }

  ack(agent: string): void {
    for (const n of this.notices) this.acked.add(`${agent}\n${n.id}`);
  }

  history(threadId?: string): HistoryEvent[] {
    return this.events.filter((e) => threadId === undefined || e.threadId === threadId);
  }

  touchAgent(name: string, now: number): void {
    this.agents.set(name, { at: now, firstSeen: this.agents.get(name)?.firstSeen ?? now });
  }

  lastAgent(now: number): { name: string | null; online: boolean } {
    let name: string | null = null;
    let at = -Infinity;
    for (const [n, seen] of this.agents) {
      if (seen.at >= at) { name = n; at = seen.at; }
    }
    return { name, online: name !== null && now - at <= ONLINE_MS };
  }
}
