import { DomainError } from "../domain/errors.ts";
import type { ThreadRepository } from "../domain/repositories.ts";
import type { Thread } from "../domain/thread.ts";

export function loadThread(repo: ThreadRepository, id: string): Thread {
  const t = repo.get(id);
  if (!t) throw new DomainError("not_found", `thread ${id} not found`);
  return t;
}
