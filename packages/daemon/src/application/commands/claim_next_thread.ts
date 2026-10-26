import type { ThreadDto } from "@app/shared";
import type { CheckpointStore } from "../../domain/checkpoint_store.ts";
import { DomainError } from "../../domain/errors.ts";
import type { Clock, GitInfo, ThreadRepository } from "../../domain/repositories.ts";
import { AgentName, Branch } from "../../domain/value_objects.ts";
import { checkpointError } from "../save_checkpoint.ts";

export class ClaimNextThreadHandler {
  private repo: ThreadRepository;
  private clock: Clock;
  private git: GitInfo;
  private checkpoints: CheckpointStore;
  constructor(repo: ThreadRepository, clock: Clock, git: GitInfo, checkpoints: CheckpointStore) {
    this.repo = repo;
    this.clock = clock;
    this.git = git;
    this.checkpoints = checkpoints;
  }

  handle(cmd: { agent: string; branch?: string }): ThreadDto | null {
    const now = this.clock.now();
    const agent = AgentName.of(cmd.agent);
    this.repo.touchAgent(agent.value, now);
    const branch = cmd.branch !== undefined ? Branch.of(cmd.branch) : this.git.branch();
    const thread = this.repo.claimNext(branch, agent, now);
    if (!thread) return null;

    let checkpoint: string;
    try {
      checkpoint = this.checkpoints.snapshot(`before thread #${thread.n}`);
    } catch (e) {
      if (e instanceof DomainError && e.code === "no_git") return thread.toDto(now); // no git: work goes on without restore points
      this.giveBack(thread.id, now);
      throw checkpointError("save a checkpoint before the agent starts", e);
    }
    const asked = [...thread.messages].reverse().find((m) => m.author === "user" && !m.discarded) ?? thread.messages[thread.messages.length - 1]!;
    thread.attachCheckpoint(asked.id, checkpoint);
    this.repo.save(thread);
    return thread.toDto(now);
  }

  /** The claim could not get its checkpoint: put the thread back in the queue. */
  private giveBack(id: string, now: number): void {
    try {
      const thread = this.repo.get(id);
      if (!thread) return;
      thread.release(now);
      this.repo.save(thread);
    } catch {
      // The checkpoint error is the one worth reporting. A stale claim is requeued after 30 minutes anyway.
    }
  }
}
