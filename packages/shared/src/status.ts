import type { ThreadStatus } from "./types.ts";

const labels: Record<ThreadStatus | "discarded", string> = {
  pending: "pending",
  received: "received",
  waiting: "waiting on you",
  resolved: "resolved",
  discarded: "discarded",
};

export function statusLabel(s: ThreadStatus | "discarded"): string {
  return labels[s];
}

export type AgentSeen = { name: string | null; seenAt: number | null };
export type AgentState = {
  /** listening: it asked in the last 8 s, which an open `wait` does every 2 s (any command counts, so this is a good guess, not proof). idle: asked lately, so it is busy or between two waits. away: not for a long time. none: never. */
  kind: "listening" | "idle" | "away" | "none";
  /** Short words for the panel pill and the status line; the pill is only about 120 px wide, so no "ago". */
  label: string;
  /** Why, and what to run when it is not listening. */
  hint: string;
};

const LISTENING_MS = 8_000;
const IDLE_MS = 10 * 60_000;

/** "8 s ago", "5 min ago", "3 h ago". */
export function ago(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 90) return `${s} s ago`;
  const m = Math.round(s / 60);
  return m < 90 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
}

/** The one definition of "is the agent connected", used by the panel, `status` and the extension button. `now` is the browser's or CLI's clock; both run on the same machine as the daemon. */
export function agentState(agent: AgentSeen, now: number, cli: string): AgentState {
  const name = agent.name ?? "agent";
  if (agent.seenAt === null) return { kind: "none", label: "no agent", hint: `No agent has asked for comments yet. Tell your agent to run \`${cli} wait\`.` };
  const age = Math.max(0, now - agent.seenAt);
  if (age <= LISTENING_MS) return { kind: "listening", label: "listening", hint: `${name} asked for comments a moment ago, so it is most likely waiting.` };
  if (age <= IDLE_MS) return { kind: "idle", label: `idle · ${ago(age).replace(" ago", "")}`, hint: `${name} last asked ${ago(age)}. It is busy or between two waits; comments are kept until it asks again. To make it listen: \`${cli} wait\`.` };
  return { kind: "away", label: `away · ${ago(age).replace(" ago", "")}`, hint: `${name} last asked ${ago(age)}. Tell your agent to run \`${cli} wait\`.` };
}
