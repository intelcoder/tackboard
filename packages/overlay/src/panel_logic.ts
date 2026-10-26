// Plain functions with no DOM, so they are easy to test.
import { statusLabel } from "@app/shared";
import type { ThreadDto } from "@app/shared";
import { ApiError } from "./api.ts";
import type { NotificationState } from "./notifications.ts";

export type Tab = "open" | "resolved";

/** Open means not resolved. Discarded threads are never listed. */
export function visibleThreads(threads: ThreadDto[], tab: Tab): ThreadDto[] {
  return threads.filter((t) => !t.discarded && (tab === "resolved") === (t.status === "resolved"));
}

/** Threads waiting on the user or unread, each counted once. */
export function badgeCount(threads: ThreadDto[]): number {
  return threads.filter((t) => !t.discarded && (t.status === "waiting" || t.unread)).length;
}

export function badgeLabel(count: number): string {
  return count > 0 ? `Comments, ${count} ${statusLabel("waiting")} or unread` : "Comments";
}

/** Moves a box so all of it is inside the viewport. A box bigger than the viewport sits at the corner. */
export function clampToViewport(
  box: { x: number; y: number; w: number; h: number },
  viewport: { w: number; h: number },
): { x: number; y: number } {
  const fit = (at: number, size: number, room: number) => Math.max(0, Math.min(at, room - size));
  return { x: fit(box.x, box.w, viewport.w), y: fit(box.y, box.h, viewport.h) };
}

export type Banner = "ask" | "link" | "blocked" | null;

export function bannerFor(state: NotificationState, dismissed: boolean): Banner {
  if (state === "denied") return "blocked";
  if (state === "default") return dismissed ? "link" : "ask";
  return null;
}

export type ChangeEvent =
  | { kind: "reply"; threadId: string; n: number; agent: string; text: string }
  | { kind: "received"; threadId: string; n: number; agent: string }
  | { kind: "resolved"; threadId: string; n: number };

/** What a poll changed that the user should hear about: new agent messages, claimed, resolved. */
export function diffForEvents(before: ThreadDto[], after: ThreadDto[]): ChangeEvent[] {
  const events: ChangeEvent[] = [];
  const old = new Map(before.map((t) => [t.id, t]));
  for (const t of after) {
    if (t.discarded) continue;
    const was = old.get(t.id);
    const seen = new Set(was?.messages.map((m) => m.id));
    for (const m of t.messages) {
      if (seen.has(m.id) || m.discarded || m.author === "user" || m.author === "system") continue;
      events.push({ kind: "reply", threadId: t.id, n: t.n, agent: m.author, text: m.text });
    }
    if (!was || was.status === t.status) continue;
    if (t.status === "received") events.push({ kind: "received", threadId: t.id, n: t.n, agent: t.agent ?? "agent" });
    if (t.status === "resolved") events.push({ kind: "resolved", threadId: t.id, n: t.n });
  }
  return events;
}

export function restoreDisabledReason(list: { restoreBlocked: string | null }): string | null {
  return list.restoreBlocked;
}

/** The sentence shown to the user when a call fails. */
export function errorText(error: unknown): string {
  return error instanceof ApiError ? error.message : "Cannot reach the daemon";
}
