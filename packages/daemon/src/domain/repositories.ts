import type { HistoryEvent, Notice } from "@app/shared";
import type { Thread } from "./thread.ts";
import type { AgentName, Branch, CommitSha } from "./value_objects.ts";

/** Restore notices for agents. An agent only gets notices that came after it was first seen (see touchAgent). */
export interface NoticeRepository {
  add(n: Notice): void;
  /** Notices later than the agent's first_seen that it has not acked, oldest first. Unknown agent: none. */
  pendingFor(agent: string): Notice[];
  /** Acks every notice saved so far for this agent. */
  ack(agent: string): void;
}

export interface ThreadRepository extends NoticeRepository {
  nextId(): string;
  nextNumber(branch: Branch): number;
  nextSeq(): number;
  get(id: string): Thread | null;
  /** Persists the thread, its messages and appends pullEvents() to the event log in one operation. */
  save(t: Thread): void;
  /** Re-queues stale claims on the branch (recording `requeued`), then claims the oldest pending non-discarded thread. */
  claimNext(branch: Branch, agent: AgentName, now: number): Thread | null;
  /** Saves all the threads and the notice in one operation: either all of it is stored or none. */
  saveRestore(threads: Thread[], notice: Notice): void;
  listByBranch(branch: Branch): Thread[];
  listAll(): Thread[];
  history(threadId?: string): HistoryEvent[];
  /** Records the agent as seen now. The first time also sets its first_seen, which never changes. */
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
