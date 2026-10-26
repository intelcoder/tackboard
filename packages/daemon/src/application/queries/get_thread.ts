import type { ThreadDto } from "@app/shared";
import type { Clock, ThreadRepository } from "../../domain/repositories.ts";
import { loadThread } from "../load_thread.ts";

export class GetThreadHandler {
  private repo: ThreadRepository;
  private clock: Clock;
  constructor(repo: ThreadRepository, clock: Clock) {
    this.repo = repo;
    this.clock = clock;
  }

  handle(q: { id: string }): ThreadDto {
    return loadThread(this.repo, q.id).toDto(this.clock.now());
  }
}
