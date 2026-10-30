import type { HistoryEvent } from "@app/shared";
import type { ThreadRepository } from "../../domain/repositories.ts";

export class GetHistoryHandler {
  private repo: ThreadRepository;
  constructor(repo: ThreadRepository) {
    this.repo = repo;
  }

  /** Events of one thread, or of every thread on a branch and/or page. A page is matched without its #hash and trailing slash. */
  handle(q: { threadId?: string; branch?: string; url?: string }): HistoryEvent[] {
    const events = this.repo.history(q.threadId);
    if (q.branch === undefined && q.url === undefined) return events;
    const ids = new Set(
      this.repo.listAll()
        .filter((t) => (q.branch === undefined || t.branch === q.branch) && (q.url === undefined || samePage(t.url, q.url)))
        .map((t) => t.id),
    );
    return events.filter((e) => e.threadId !== null && ids.has(e.threadId));
  }
}

export function samePage(a: string, b: string): boolean {
  const bare = (u: string) => u.replace(/#.*$/, "").replace(/\/$/, "");
  return bare(a) === bare(b);
}
