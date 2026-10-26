import { LIMITS } from "@app/shared";
import type { ElementRef, ThreadDto } from "@app/shared";
import type { Clock, GitInfo, ThreadRepository } from "../../domain/repositories.ts";
import { Thread } from "../../domain/thread.ts";

export type PostCommentCommand = {
  element: ElementRef;
  url: string;
  viewport: { w: number; h: number };
  text: string;
};

export class PostCommentHandler {
  private repo: ThreadRepository;
  private clock: Clock;
  private git: GitInfo;
  constructor(repo: ThreadRepository, clock: Clock, git: GitInfo) {
    this.repo = repo;
    this.clock = clock;
    this.git = git;
  }

  handle(cmd: PostCommentCommand): ThreadDto {
    const now = this.clock.now();
    const branch = this.git.branch();
    const thread = Thread.open({
      id: this.repo.nextId(),
      n: this.repo.nextNumber(branch),
      branch,
      commit: this.git.commit(),
      url: cmd.url,
      viewport: cmd.viewport,
      element: { ...cmd.element, html: cmd.element.html.slice(0, LIMITS.html), text: cmd.element.text.slice(0, LIMITS.elementText) },
      text: cmd.text,
      now,
      seq: this.repo.nextSeq(),
    });
    this.repo.save(thread);
    return thread.toDto(now);
  }
}
