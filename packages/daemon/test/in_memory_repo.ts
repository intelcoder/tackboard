import type { HistoryEvent } from "@app/shared";
import type { ThreadRepository } from "../src/domain/repositories.ts";
import type { Thread } from "../src/domain/thread.ts";
import type { AgentName, Branch } from "../src/domain/value_objects.ts";

const ONLINE_MS = 60_000;

export class InMemoryThreadRepository implements ThreadRepository {
  private threads = new Map<string, Thread>();
  private events: HistoryEvent[] = [];
  private idCounter = 0;
  private seqCounter = 0;
  private numbers = new Map<string, number>();
  private agents = new Map<string, number>();

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
    return this.threads.get(id) ?? null;
  }

  save(t: Thread): void {
    this.threads.set(t.id, t);
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
    return [...this.threads.values()].filter((t) => t.branch === branch.value).sort((a, b) => a.n - b.n);
  }

  listAll(): Thread[] {
    return [...this.threads.values()];
  }

  history(threadId?: string): HistoryEvent[] {
    return this.events.filter((e) => threadId === undefined || e.threadId === threadId);
  }

  touchAgent(name: string, now: number): void {
    this.agents.set(name, now);
  }

  lastAgent(now: number): { name: string | null; online: boolean } {
    let name: string | null = null;
    let at = -Infinity;
    for (const [n, t] of this.agents) {
      if (t >= at) { name = n; at = t; }
    }
    return { name, online: name !== null && now - at <= ONLINE_MS };
  }
}
