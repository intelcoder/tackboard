import type { Notice } from "@app/shared";

/** What an agent is told after a restore: where the project went back to, which files changed, which threads are gone. */
export function newNotice(a: {
  id: string;
  at: number;
  threadId: string;
  messageId: string;
  files: string[];
  discardedThreads: string[];
}): Notice {
  return {
    id: a.id,
    at: a.at,
    restoredToMessage: `${a.threadId}/${a.messageId}`,
    files: [...a.files],
    discardedThreads: [...a.discardedThreads],
  };
}
