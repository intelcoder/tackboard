import type { ThreadRepository } from "../../domain/repositories.ts";
import { AgentName } from "../../domain/value_objects.ts";

export class AckNoticesHandler {
  private repo: ThreadRepository;
  constructor(repo: ThreadRepository) {
    this.repo = repo;
  }

  handle(cmd: { agent: string }): void {
    this.repo.ack(AgentName.of(cmd.agent).value);
  }
}
