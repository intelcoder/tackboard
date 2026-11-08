import type { ThreadDto } from "@app/shared";
import type { CheckpointStore } from "../../domain/checkpoint_store.ts";
import type { Clock, ScreenshotStore, ThreadRepository } from "../../domain/repositories.ts";
import { AgentName } from "../../domain/value_objects.ts";
import { loadThread } from "../load_thread.ts";
import { checkpointIfChanged } from "../save_checkpoint.ts";

export class ReplyToThreadHandler {
  private repo: ThreadRepository;
  private clock: Clock;
  private checkpoints: CheckpointStore;
  private shots: ScreenshotStore;
  constructor(repo: ThreadRepository, clock: Clock, checkpoints: CheckpointStore, shots: ScreenshotStore) {
    this.repo = repo;
    this.clock = clock;
    this.checkpoints = checkpoints;
    this.shots = shots;
  }

  handle(cmd: { id: string; author: string; text: string; ask?: boolean; screenshot?: Buffer; detail?: string }): ThreadDto {
    const now = this.clock.now();
    const thread = loadThread(this.repo, cmd.id);
    if (cmd.author !== "user") this.repo.touchAgent(AgentName.of(cmd.author).value, now);
    // The checkpoint is taken before the thread changes, so a failure leaves the thread as it was.
    const checkpoint = checkpointIfChanged(this.checkpoints, thread, `after reply on thread #${thread.n}`);
    // One picture per message, named by the message it belongs to, so a later picture never replaces an earlier one.
    const screenshot = cmd.screenshot && cmd.author === "user" ? this.shots.save(`${thread.id}-m${thread.messages.length + 1}`, cmd.screenshot) : undefined;
    thread.reply(cmd.author, cmd.text, now, this.repo.nextSeq(), { ...(cmd.ask ? { ask: true } : {}), ...(screenshot ? { screenshot } : {}), ...(cmd.detail && cmd.author === "user" ? { detail: cmd.detail } : {}) });
    if (checkpoint) thread.attachCheckpoint(thread.messages[thread.messages.length - 1]!.id, checkpoint);
    this.repo.save(thread);
    return thread.toDto(now);
  }
}
