import type { Notice } from "@app/shared";
import type { Clock, ThreadRepository } from "../../domain/repositories.ts";
import { AgentName } from "../../domain/value_objects.ts";

export class GetNoticesHandler {
  private repo: ThreadRepository;
  private clock: Clock;
  constructor(repo: ThreadRepository, clock: Clock) {
    this.repo = repo;
    this.clock = clock;
  }

  /** Also records the agent as seen, which sets the first time it was seen once. */
  handle(q: { agent: string }): Notice[] {
    const agent = AgentName.of(q.agent);
    this.repo.touchAgent(agent.value, this.clock.now());
    return this.repo.pendingFor(agent.value);
  }
}
