import type { HistoryEvent } from "@app/shared";
import type { Thread } from "./thread.ts";
import type { AgentName, Branch, CommitSha } from "./value_objects.ts";

export interface ThreadRepository {
  nextId(): string;
  nextNumber(branch: Branch): number;
  nextSeq(): number;
  get(id: string): Thread | null;
  /** Persists the thread, its messages and appends pullEvents() to the event log in one operation. */
  save(t: Thread): void;
  /** Re-queues stale claims on the branch (recording `requeued`), then claims the oldest pending non-discarded thread. */
  claimNext(branch: Branch, agent: AgentName, now: number): Thread | null;
  listByBranch(branch: Branch): Thread[];
  listAll(): Thread[];
  history(threadId?: string): HistoryEvent[];
  touchAgent(name: string, now: number): void;
  lastAgent(now: number): { name: string | null; online: boolean };
}

export interface Clock {
  now(): number;
}

export interface GitInfo {
  branch(): Branch;
  commit(): CommitSha;
  branches(): string[];
}
