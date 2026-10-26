import type { ThreadDto } from "@app/shared";
import type { Clock, ThreadRepository } from "../../domain/repositories.ts";
import { AgentName } from "../../domain/value_objects.ts";
import { loadThread } from "../load_thread.ts";

export class ReplyToThreadHandler {
  private repo: ThreadRepository;
  private clock: Clock;
  constructor(repo: ThreadRepository, clock: Clock) {
    this.repo = repo;
    this.clock = clock;
  }

  handle(cmd: { id: string; author: string; text: string; ask?: boolean }): ThreadDto {
    const now = this.clock.now();
    const thread = loadThread(this.repo, cmd.id);
    if (cmd.author !== "user") this.repo.touchAgent(AgentName.of(cmd.author).value, now);
    thread.reply(cmd.author, cmd.text, now, this.repo.nextSeq(), cmd.ask ? { ask: true } : {});
    this.repo.save(thread);
    return thread.toDto(now);
  }
}
