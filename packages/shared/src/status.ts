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
