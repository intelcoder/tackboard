import { brand } from "@app/shared";
import type { Sites } from "./sites.ts";
import { isLocalKey, siteKey } from "./sites.ts";

export type Found = { port: number; token: string; dir: string };

/** Asks the fixed port. Only the extension's origin gets an answer, and only our own daemon answers in this shape. */
export async function scan(fetchFn: typeof fetch = fetch): Promise<Found | undefined> {
  const port = brand.pairPort;
  try {
    const res = await fetchFn(`http://127.0.0.1:${port}${brand.pairPath}`, { method: "POST", signal: AbortSignal.timeout(500) });
    const body = (await res.json()) as { pair?: unknown; token?: unknown; dir?: unknown };
    if (res.ok && body.pair === 1 && typeof body.token === "string" && typeof body.dir === "string") return { port, token: body.token, dir: body.dir };
  } catch {
    // nothing there, or not our daemon
  }
}

/** The saved sites with this local page added (on) or its daemon address and token refreshed. Same object back when nothing changed. A site the user turned off stays off. */
export async function pairSites(sites: Sites, tabUrl: string, fetchFn: typeof fetch = fetch): Promise<Sites> {
  const key = siteKey(tabUrl);
  if (key === undefined || !isLocalKey(key)) return sites;
  const daemon = await scan(fetchFn);
  if (!daemon) return sites;
  const address = `http://127.0.0.1:${daemon.port}`;
  const saved = sites[key];
  if (saved?.daemon === address && saved.token === daemon.token) return sites;
  return { ...sites, [key]: { daemon: address, token: daemon.token, on: saved?.on ?? true } };
}
