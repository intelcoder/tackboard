import type { ThreadDto } from "@app/shared";
import type { CheckpointStore } from "../../domain/checkpoint_store.ts";
import type { Clock, ThreadRepository } from "../../domain/repositories.ts";
import { loadThread } from "../load_thread.ts";
import { checkpointIfChanged } from "../save_checkpoint.ts";

export class ResolveThreadHandler {
  private repo: ThreadRepository;
  private clock: Clock;
  private checkpoints: CheckpointStore;
  constructor(repo: ThreadRepository, clock: Clock, checkpoints: CheckpointStore) {
    this.repo = repo;
    this.clock = clock;
    this.checkpoints = checkpoints;
  }

  handle(cmd: { id: string; by: "user" | "agent" }): ThreadDto {
    const now = this.clock.now();
    const thread = loadThread(this.repo, cmd.id);
    // Resolve adds no message, so the checkpoint goes on the last one, and only if that message has none yet.
    const last = thread.messages[thread.messages.length - 1]!;
    const checkpoint = last.checkpointId === undefined
      ? checkpointIfChanged(this.checkpoints, thread, `after resolve of thread #${thread.n}`)
      : null;
    thread.resolve(cmd.by, now);
    if (checkpoint) thread.attachCheckpoint(last.id, checkpoint);
    this.repo.save(thread);
    return thread.toDto(now);
  }
}
