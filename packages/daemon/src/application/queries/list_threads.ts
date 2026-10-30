import type { ListThreadsResponse } from "@app/shared";
import type { Clock, GitInfo, ThreadRepository } from "../../domain/repositories.ts";
import { Thread } from "../../domain/thread.ts";
import { Branch } from "../../domain/value_objects.ts";
import { samePage } from "./get_history.ts";

const NEVER_ARCHIVED = new Set(["HEAD", "no-git"]);

export class ListThreadsHandler {
  private repo: ThreadRepository;
  private clock: Clock;
  private git: GitInfo;
  constructor(repo: ThreadRepository, clock: Clock, git: GitInfo) {
    this.repo = repo;
    this.clock = clock;
    this.git = git;
  }

  handle(q: { branch?: string; state?: "open" | "resolved"; url?: string }): ListThreadsResponse {
    const now = this.clock.now();
    const branch = q.branch !== undefined ? Branch.of(q.branch) : this.git.branch();
    const live = this.repo.listByBranch(branch).filter((t) => !t.discarded);
    const shown = live.filter((t) => (q.state === undefined || (q.state === "resolved") === (t.status === "resolved")) && (q.url === undefined || samePage(t.url, q.url)));
    const existing = new Set(this.git.branches());
    const archived = this.repo.listAll().filter((t) => {
      if (t.branch === branch.value) return t.discarded;
      return !existing.has(t.branch) && !NEVER_ARCHIVED.has(t.branch);
    });
    return {
      branch: branch.value,
      threads: shown.map((t) => t.toDto(now)),
      history: archived.map((t) => t.toDto(now)),
      agent: this.repo.lastAgent(now),
      restoreBlocked: Thread.restoreBlocker(live, now),
    };
  }
}
