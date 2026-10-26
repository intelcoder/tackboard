import { DomainError } from "../domain/errors.ts";
import type { CheckpointStore } from "../domain/checkpoint_store.ts";
import type { Thread } from "../domain/thread.ts";

/** Turns any failure of the checkpoint store into a DomainError with a plain message. Domain errors pass through. */
export function checkpointError(what: string, e: unknown): DomainError {
  if (e instanceof DomainError) return e;
  const reason = e instanceof Error ? e.message.trim() : String(e);
  return new DomainError("internal", `could not ${what}: ${reason}`);
}

/** The newest checkpoint of the thread that is still kept. Messages from the system do not count. */
function newestCheckpoint(thread: Thread): string | undefined {
  for (let i = thread.messages.length - 1; i >= 0; i--) {
    const m = thread.messages[i]!;
    if (m.author !== "system" && !m.discarded && m.checkpointId !== undefined) return m.checkpointId;
  }
  return undefined;
}

/**
 * Takes a checkpoint only if the files changed since the thread's newest one.
 * Returns its id, or null when nothing changed, the thread has no checkpoint yet, or the folder is not a git repository.
 * Call it before changing the thread, so a failure leaves the thread as it was.
 */
export function checkpointIfChanged(store: CheckpointStore, thread: Thread, label: string): string | null {
  const last = newestCheckpoint(thread);
  if (last === undefined) return null;
  try {
    if (!store.hasChangedSince(last)) return null;
    return store.snapshot(label);
  } catch (e) {
    if (e instanceof DomainError && e.code === "no_git") return null;
    throw checkpointError("save a checkpoint", e);
  }
}
