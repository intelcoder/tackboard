import { brand } from "@app/shared";
import type { Sites } from "./sites.ts";

/** The origin of a web page address, or nothing for chrome://, about:, file: and a missing address. */
function webOrigin(tabUrl: string | undefined): string | undefined {
  try {
    const url = new URL(tabUrl ?? "");
    return url.protocol === "http:" || url.protocol === "https:" ? url.origin : undefined;
  } catch {
    return undefined;
  }
}

export type Click = { kind: "flip"; origin: string; on: boolean } | { kind: "add"; site?: string };

/** What a click on the toolbar button does for the page in this tab. */
export function whatClickDoes(sites: Sites, tabUrl: string | undefined): Click {
  const origin = webOrigin(tabUrl);
  if (origin === undefined) return { kind: "add" };
  const saved = sites[origin];
  return saved ? { kind: "flip", origin, on: !saved.on } : { kind: "add", site: origin };
}

/** The words, background colour and hover title for the button on this tab. The words are drawn white on both colours. */
export function badgeFor(sites: Sites, tabUrl: string | undefined): { text: string; color: string; title: string } {
  const saved = sites[webOrigin(tabUrl) ?? ""];
  if (saved?.on) return { text: "ON", color: "#1a7f37", title: `${brand.name}: on for this site. Click to turn it off.` };
  if (saved) return { text: "OFF", color: "#6b7280", title: `${brand.name}: off for this site. Click to turn it on.` };
  return { text: "", color: "#6b7280", title: `${brand.name}: this site is not added. Click to add this site.` };
}
