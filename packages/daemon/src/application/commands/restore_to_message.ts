import type { RestoreResult } from "@app/shared";
import type { CheckpointStore } from "../../domain/checkpoint_store.ts";
import { DomainError } from "../../domain/errors.ts";
import { newNotice } from "../../domain/notice.ts";
import type { Clock, GitInfo, ThreadRepository } from "../../domain/repositories.ts";
import { Thread } from "../../domain/thread.ts";
import { loadThread } from "../load_thread.ts";
import { checkpointError } from "../save_checkpoint.ts";

/**
 * Puts the project files back to what they were at a message, and marks everything after it as discarded.
 * Order matters: checks first, then the safety checkpoint, then the files, and only then the thread data.
 * If a step after the files fails, the files go back to the safety checkpoint and the thread data is left alone.
 */
export class RestoreToMessageHandler {
  private repo: ThreadRepository;
  private clock: Clock;
  private git: GitInfo;
  private checkpoints: CheckpointStore;
  constructor(repo: ThreadRepository, clock: Clock, git: GitInfo, checkpoints: CheckpointStore) {
    this.repo = repo;
    this.clock = clock;
    this.git = git;
    this.checkpoints = checkpoints;
  }

  handle(cmd: { threadId: string; messageId: string }): RestoreResult {
    const now = this.clock.now();
    const asked = loadThread(this.repo, cmd.threadId);
    const branch = this.git.branch();
    if (branch.value === "no-git") throw new DomainError("no_git", "restore needs a git repository, and this project is not one");
    if (asked.branch !== branch.value) {
      throw new DomainError("wrong_branch", `thread #${asked.n} is on branch ${asked.branch}, but ${branch.value} is checked out`);
    }
    const threads = this.repo.listByBranch(branch);
    const blocker = Thread.restoreBlocker(threads, now);
    if (blocker) throw new DomainError("restore_blocked", blocker);

    const thread = threads.find((t) => t.id === asked.id) ?? asked;
    const target = thread.toState().messages.find((m) => m.id === cmd.messageId);
    if (!target) throw new DomainError("not_found", `message ${cmd.messageId} not found in thread #${thread.n}`);
    if (target.discarded) throw new DomainError("invalid", `message ${target.id} was discarded by an earlier restore`);
    if (target.checkpointId === undefined) throw new DomainError("invalid", `message ${target.id} has no checkpoint to restore`);

    const safety = this.step("save a safety checkpoint", () => this.checkpoints.snapshot(`before restore to ${thread.id}/${target.id}`));
    const files = this.step("list the files to restore", () => this.checkpoints.changedFiles(safety, target.checkpointId!));
    try {
      this.checkpoints.restore(target.checkpointId);
    } catch (e) {
      this.putFilesBack(safety);
      throw checkpointError("restore the files", e);
    }

    const discardedMessageIds: string[] = [];
    const discardedThreadIds: string[] = [];
    const changed: Thread[] = [];
    for (const t of threads) {
      const wasDiscarded = t.discarded;
      const ids = t.discardAfterSeq(target.seq);
      for (const id of ids) discardedMessageIds.push(`${t.id}/${id}`);
      if (!wasDiscarded && t.discarded) discardedThreadIds.push(t.id);
      if (ids.length > 0 || t.id === thread.id) changed.push(t);
    }
    thread.noteRestore(target.id, safety, now, this.repo.nextSeq(), {
      restoredTo: target.id, safetyCheckpointId: safety, discardedMessageIds, discardedThreadIds, changedFiles: files,
    });
    const notice = newNotice({
      id: `n${this.repo.nextSeq()}`, at: now, threadId: thread.id, messageId: target.id, files, discardedThreads: discardedThreadIds,
    });
    try {
      this.repo.saveRestore(changed, notice);
    } catch (e) {
      this.putFilesBack(safety);
      throw checkpointError("save the restore", e);
    }
    return { restoredTo: target.id, discardedMessageIds, discardedThreadIds, changedFiles: files, safetyCheckpointId: safety };
  }

  private step<T>(what: string, run: () => T): T {
    try {
      return run();
    } catch (e) {
      throw checkpointError(what, e);
    }
  }

  /** Undo a half-done restore by restoring the safety checkpoint. If even that fails, the safety id is in the error. */
  private putFilesBack(safety: string): void {
    try {
      this.checkpoints.restore(safety);
    } catch (e) {
      throw checkpointError(`put the files back; the saved state is checkpoint ${safety}`, e);
    }
  }
}
