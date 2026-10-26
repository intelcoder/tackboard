import type { HistoryEvent } from "@app/shared";
import type { ThreadRepository } from "../../domain/repositories.ts";

export class GetHistoryHandler {
  private repo: ThreadRepository;
  constructor(repo: ThreadRepository) {
    this.repo = repo;
  }

  handle(q: { threadId?: string }): HistoryEvent[] {
    return this.repo.history(q.threadId);
  }
}
