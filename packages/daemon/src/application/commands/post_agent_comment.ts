import type { ThreadDto } from "@app/shared";
import type { Clock, GitInfo, ThreadRepository } from "../../domain/repositories.ts";
import { Thread } from "../../domain/thread.ts";
import { AgentName } from "../../domain/value_objects.ts";

export type PostAgentCommentCommand = { agent: string; selector: string; text: string; url?: string };

export class PostAgentCommentHandler {
  private repo: ThreadRepository;
  private clock: Clock;
  private git: GitInfo;
  constructor(repo: ThreadRepository, clock: Clock, git: GitInfo) {
    this.repo = repo;
    this.clock = clock;
    this.git = git;
  }

  handle(cmd: PostAgentCommentCommand): ThreadDto {
    const now = this.clock.now();
    const agent = AgentName.of(cmd.agent);
    this.repo.touchAgent(agent.value, now);
    const branch = this.git.branch();
    const thread = Thread.openByAgent({
      id: this.repo.nextId(),
      n: this.repo.nextNumber(branch),
      branch,
      commit: this.git.commit(),
      url: cmd.url ?? "",
      element: {
        selector: cmd.selector, tag: "", text: "", html: "",
        rect: { x: 0, y: 0, w: 0, h: 0 }, confidence: "text",
      },
      agent,
      text: cmd.text,
      now,
      seq: this.repo.nextSeq(),
    });
    this.repo.save(thread);
    return thread.toDto(now);
  }
}
