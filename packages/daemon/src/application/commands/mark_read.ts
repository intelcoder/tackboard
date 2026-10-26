import type { ThreadDto } from "@app/shared";
import type { Clock, ThreadRepository } from "../../domain/repositories.ts";
import { loadThread } from "../load_thread.ts";

export class MarkReadHandler {
  private repo: ThreadRepository;
  private clock: Clock;
  constructor(repo: ThreadRepository, clock: Clock) {
    this.repo = repo;
    this.clock = clock;
  }

  handle(cmd: { id: string }): ThreadDto {
    const thread = loadThread(this.repo, cmd.id);
    thread.markRead();
    this.repo.save(thread);
    return thread.toDto(this.clock.now());
  }
}
