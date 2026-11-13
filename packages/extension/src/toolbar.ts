import { agentState, brand } from "@app/shared";
import type { AgentState, ListThreadsResponse } from "@app/shared";
import type { Sites } from "./sites.ts";
import { siteKey as webOrigin } from "./sites.ts";

export type Click = { kind: "flip"; origin: string; on: boolean } | { kind: "add"; site?: string };

/** What a click on the toolbar button does for the page in this tab. */
export function whatClickDoes(sites: Sites, tabUrl: string | undefined): Click {
  const origin = webOrigin(tabUrl);
  if (origin === undefined) return { kind: "add" };
  const saved = sites[origin];
  return saved ? { kind: "flip", origin, on: !saved.on } : { kind: "add", site: origin };
}

/** What the daemon last said to this tab: the agent's state, or that the call failed. Unknown until the panel has asked once. */
export type Link = AgentState | "unreachable";

/** What a redraw of the button depends on: the state, not the hint's changing age. */
export const linkKey = (link: Link | undefined): string => (link === undefined ? "" : typeof link === "string" ? link : link.kind);

/** The words, background colour and hover title for the button on this tab. The words are drawn white on both colours. */
export function badgeFor(sites: Sites, tabUrl: string | undefined, link?: Link): { text: string; color: string; title: string } {
  const saved = sites[webOrigin(tabUrl) ?? ""];
  if (saved?.on) {
    const off = "Click to turn it off.";
    if (link === "unreachable") return { text: "!", color: "#b42318", title: `${brand.name}: on, but the daemon cannot be reached or refused the token. Run \`${brand.cli} doctor\` in your project. ${off}` };
    if (link && (link.kind === "away" || link.kind === "none")) return { text: "ON?", color: "#b45309", title: `${brand.name}: on, but no agent is listening. ${link.hint} ${off}` };
    return { text: "ON", color: "#1a7f37", title: `${brand.name}: on for this site.${link ? ` ${link.hint}` : ""} ${off}` };
  }
  if (saved) return { text: "OFF", color: "#6b7280", title: `${brand.name}: off for this site. Click to turn it on.` };
  const title = webOrigin(tabUrl) ? `${brand.name}: this site is not added. Click to add this site.` : `${brand.name}: click to open the site list.`;
  return { text: "", color: "#6b7280", title };
}

/** Whether an update to a tab can change its button: a new address or a page loading. A new title, icon or sound cannot. */
export function badgeNeedsUpdate(changes: Record<string, unknown>): boolean {
  return "url" in changes || "status" in changes;
}

/** What a daemon answer to the thread-list call says about the link, or undefined when it says nothing (not that call, or a body that is not a thread list). A refused token or a daemon error is as unusable as no daemon. */
export function linkFrom(result: unknown, now: number): Link | undefined {
  const r = result as { status?: number; text?: string; error?: string } | null;
  if (r?.error || (r?.status !== undefined && r.status !== 200)) return "unreachable";
  if (r?.status !== 200 || typeof r.text !== "string") return undefined;
  try {
    return agentState((JSON.parse(r.text) as ListThreadsResponse).agent, now, brand.cli);
  } catch {
    return undefined;
  }
}
