// Plain functions with no DOM, so they are easy to test.
import { agentIsUp, brand, statusLabel } from "@app/shared";
import type { AgentSeen, ThreadDto } from "@app/shared";
import { ApiError } from "./api.ts";
import type { NotificationState } from "./notifications.ts";

export type Tab = "open" | "resolved";
/** Who started the thread: you, or an agent (for example a UX review). */
export type Source = "all" | "user" | "agent";

const lastAt = (t: ThreadDto): number => t.messages.reduce((latest, m) => Math.max(latest, m.at), 0);

/** Open means not resolved. Discarded threads are never listed. Newest message first. */
export function visibleThreads(threads: ThreadDto[], tab: Tab, source: Source = "all"): ThreadDto[] {
  return threads
    .filter((t) => !t.discarded && (tab === "resolved") === (t.status === "resolved") && (source === "all" || t.openedBy === source))
    .sort((a, b) => lastAt(b) - lastAt(a));
}

/** Threads waiting on the user or unread, each counted once. */
/** A short name for a page in the "other pages" list: path, plus the host when it is not this one. */
export function pageLabel(url: string, here = ""): string {
  try {
    const u = new URL(url);
    const path = (u.pathname + u.search).replace(/\/$/, "") || "/";
    return u.origin === here ? path : `${u.host}${path}`;
  } catch {
    return url;
  }
}

/** What to paste to a coding agent so it reads the comments of this page only. */
export function agentPrompt(cli: string, path: string): string {
  return `Run \`${cli} wait --url ${path}\` and do what each comment on this page asks. Then run \`${cli} reply <id> "<what you changed>"\` for each one.`;
}

export function badgeCount(threads: ThreadDto[]): number {
  return threads.filter((t) => !t.discarded && (t.status === "waiting" || t.unread)).length;
}

export function badgeLabel(count: number): string {
  return count > 0 ? `Comments, ${count} ${statusLabel("waiting")} or unread` : "Comments";
}

type Box = { x: number; y: number; w: number; h: number };

const PILL_GAP = 8;

/**
 * Moves a box so all of it is inside the viewport. A box bigger than the viewport sits at the corner.
 * With the pill's box, the box also stays clear of it: it moves up above the pill, and when it is too tall
 * for that it sits at the top and gets a `maxHeight` that ends above the pill.
 */
export function clampToViewport(
  box: Box,
  viewport: { w: number; h: number },
  pill?: Box,
): { x: number; y: number; maxHeight?: number } {
  const fit = (at: number, size: number, room: number) => Math.max(0, Math.min(at, room - size));
  const x = fit(box.x, box.w, viewport.w);
  const y = fit(box.y, box.h, viewport.h);
  if (!pill) return { x, y };
  const beside = x + box.w <= pill.x || x >= pill.x + pill.w;
  const above = y + box.h <= pill.y;
  if (beside || above) return { x, y };
  const room = Math.max(0, pill.y - PILL_GAP);
  if (box.h <= room) return { x, y: room - box.h };
  return { x, y: 0, maxHeight: room };
}

export type Banner = "ask" | "link" | "blocked" | null;

export function bannerFor(state: NotificationState, dismissed: boolean): Banner {
  if (state === "denied") return dismissed ? null : "blocked";
  if (state === "default") return dismissed ? "link" : "ask";
  return null;
}

export type ChangeEvent =
  | { kind: "reply"; threadId: string; n: number; agent: string; text: string }
  | { kind: "received"; threadId: string; n: number; agent: string }
  | { kind: "resolved"; threadId: string; n: number }
  | { kind: "agent"; agent: string };

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

/**
 * The agent that just connected, or null. That is an agent that asked while it was away or never seen (so a `wait` or `next` the user
 * was waiting on just started), or a different agent than the one before that this page has not announced. `announced` is the names
 * already seen connected on this page; the caller fills it, so an agent already there at page load is not announced.
 */
export function agentConnected(before: AgentSeen, after: AgentSeen, now: number, announced: ReadonlySet<string>): ChangeEvent | null {
  if (after.name === null || !agentIsUp(after, now, brand.cli)) return null;
  if (!agentIsUp(before, now, brand.cli)) return { kind: "agent", agent: after.name };
  return before.name !== after.name && !announced.has(after.name) ? { kind: "agent", agent: after.name } : null;
}

export function restoreDisabledReason(list: { restoreBlocked: string | null }): string | null {
  return list.restoreBlocked;
}

/** The sentence shown to the user when a call fails. */
export function errorText(error: unknown): string {
  return error instanceof ApiError ? error.message : "Cannot reach the daemon";
}

type KeyInfo = Pick<KeyboardEvent, "key" | "shiftKey" | "ctrlKey" | "metaKey" | "isComposing" | "keyCode">;

/** Enter, Ctrl+Enter and Cmd+Enter send; Shift+Enter adds a line; the Enter that ends an input method composition is left alone. */
export function isSendKey(e: KeyInfo): boolean {
  if (e.key !== "Enter" || e.isComposing || e.keyCode === 229) return false;
  return e.ctrlKey || e.metaKey || !e.shiftKey;
}
