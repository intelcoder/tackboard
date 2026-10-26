import type { ThreadDto } from "@app/shared";
import type { Clock, ThreadRepository } from "../../domain/repositories.ts";
import { AgentName } from "../../domain/value_objects.ts";
import { loadThread } from "../load_thread.ts";

export class ResolveThreadHandler {
  private repo: ThreadRepository;
  private clock: Clock;
  constructor(repo: ThreadRepository, clock: Clock) {
    this.repo = repo;
    this.clock = clock;
  }

  handle(cmd: { id: string; by: "user" | "agent"; agent?: string }): ThreadDto {
    const now = this.clock.now();
    const thread = loadThread(this.repo, cmd.id);
    if (cmd.by === "agent" && cmd.agent !== undefined) this.repo.touchAgent(AgentName.of(cmd.agent).value, now);
    thread.resolve(cmd.by, now);
    this.repo.save(thread);
    return thread.toDto(now);
  }
}
