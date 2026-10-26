import type { ThreadDto } from "@app/shared";
import type { Clock, GitInfo, ThreadRepository } from "../../domain/repositories.ts";
import { AgentName, Branch } from "../../domain/value_objects.ts";

export class ClaimNextThreadHandler {
  private repo: ThreadRepository;
  private clock: Clock;
  private git: GitInfo;
  constructor(repo: ThreadRepository, clock: Clock, git: GitInfo) {
    this.repo = repo;
    this.clock = clock;
    this.git = git;
  }

  handle(cmd: { agent: string; branch?: string }): ThreadDto | null {
    const now = this.clock.now();
    const agent = AgentName.of(cmd.agent);
    this.repo.touchAgent(agent.value, now);
    const branch = cmd.branch !== undefined ? Branch.of(cmd.branch) : this.git.branch();
    return this.repo.claimNext(branch, agent, now)?.toDto(now) ?? null;
  }
}
