import { brand } from "@app/shared";
import type { Sites } from "./sites.ts";
import { isLocalKey, siteKey } from "./sites.ts";

export type Found = { port: number; token: string; dir: string; origins?: string[] };

/** Asks one port. Only the extension's origin gets an answer, and only our own daemon answers in this shape. */
async function ask(port: number, fetchFn: typeof fetch): Promise<Found | undefined> {
  try {
    const res = await fetchFn(`http://127.0.0.1:${port}${brand.pairPath}`, { method: "POST", signal: AbortSignal.timeout(500) });
    const body = (await res.json()) as { pair?: unknown; token?: unknown; dir?: unknown; origins?: unknown };
    if (res.ok && body.pair === 1 && typeof body.token === "string" && typeof body.dir === "string") {
      const origins = Array.isArray(body.origins) && body.origins.every((o) => typeof o === "string") ? (body.origins as string[]) : undefined;
      return { port, token: body.token, dir: body.dir, ...(origins ? { origins } : {}) };
    }
  } catch {
    // nothing there, or not our daemon
  }
}

/** Every daemon in the range, lowest port first: one per project running at once. */
export async function scan(fetchFn: typeof fetch = fetch): Promise<Found[]> {
  const ports = Array.from({ length: brand.pairSpan }, (_, i) => brand.pairPort + i);
  return (await Promise.all(ports.map((port) => ask(port, fetchFn)))).filter((d): d is Found => d !== undefined);
}

/**
 * The daemon for this page: the one whose allowed origins include it. With no match, the only daemon there is (an older daemon
 * does not list its origins); with several and no match, none, since a guess would save comments in the wrong project.
 * A page of file:// is allowed by an origin of "file://" or "null".
 */
export function pick(found: Found[], key: string): Found | undefined {
  const origins = key === "file://" ? ["file://", "null"] : [key];
  return found.find((d) => d.origins?.some((o) => origins.includes(o))) ?? (found.length === 1 ? found[0] : undefined);
}

/** The saved sites with this local page added (on) or its daemon address and token refreshed. Same object back when nothing changed. A site the user turned off stays off. */
export async function pairSites(sites: Sites, tabUrl: string, fetchFn: typeof fetch = fetch): Promise<Sites> {
  const key = siteKey(tabUrl);
  if (key === undefined || !isLocalKey(key)) return sites;
  const daemon = pick(await scan(fetchFn), key);
  if (!daemon) return sites;
  const address = `http://127.0.0.1:${daemon.port}`;
  const saved = sites[key];
  if (saved?.daemon === address && saved.token === daemon.token) return sites;
  return { ...sites, [key]: { daemon: address, token: daemon.token, on: saved?.on ?? true } };
}
