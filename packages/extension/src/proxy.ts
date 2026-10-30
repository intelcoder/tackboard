import { brand } from "@app/shared";
import type { Sites } from "./sites.ts";
import { siteKey } from "./sites.ts";

export type CallMessage = { kind: "call"; method: string; path: string; body?: string };
export type Answer = { status: number; text: string } | { error: string };

const isOn = (sites: Sites, origin: string) => sites[origin]?.on === true;

/** Answers a message from a page's tab. The site is the tab's own address, never something the message says. */
export function answerMessage(
  sites: Sites,
  sender: { tab: { url: string } },
  message: { kind: string; method: string; path: string; body?: string },
  fetchFn: typeof fetch = fetch,
): Promise<Answer | boolean> | boolean {
  const origin = siteKey(sender.tab.url) ?? "";
  return message.kind === "is_on" ? isOn(sites, origin) : callDaemon(sites, origin, message, fetchFn);
}

/** Takes a picture of the visible part of the sender's window. Only for a site that is turned on. */
export async function answerScreenshot(
  sites: Sites,
  sender: { tab: { url: string; windowId: number } },
  capture: (windowId: number) => Promise<string>,
): Promise<{ dataUrl: string } | { error: string }> {
  if (!isOn(sites, siteKey(sender.tab.url) ?? "")) return { error: "This site is not turned on in the extension" };
  try {
    return { dataUrl: await capture(sender.tab.windowId) };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** Sends one call to the daemon of a site that is on. The page side gives only a path. */
export async function callDaemon(
  sites: Sites,
  origin: string,
  message: { method: string; path: string; body?: string },
  fetchFn: typeof fetch = fetch,
): Promise<Answer> {
  const site = sites[origin];
  // Shaped like the daemon's own errors, so the overlay shows these words instead of a general failure.
  if (!site?.on) return { status: 403, text: JSON.stringify({ error: "forbidden_origin", message: "This site is not turned on in the extension" }) };
  const { method, path, body } = message;
  if (!path.startsWith("/") || path.startsWith("//")) return { error: "That path is not allowed" };
  const url = new URL(path, site.daemon);
  if (url.origin !== new URL(site.daemon).origin) return { error: "That path is not allowed" };
  const headers: Record<string, string> = { [brand.tokenHeader]: site.token };
  if (body !== undefined) headers["content-type"] = "application/json";
  try {
    const res = await fetchFn(url, { method, headers, body });
    return { status: res.status, text: await res.text() };
  } catch {
    return { error: "Cannot reach the daemon" };
  }
}
