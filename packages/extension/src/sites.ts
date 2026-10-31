export type Site = { daemon: string; token: string; on: boolean };
/** The saved sites, by page origin such as https://xxx.com or http://localhost:4321. */
export type Sites = Record<string, Site>;

export type Problem = { error: string };

const SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;
const HOST_LETTERS = /^[a-z0-9.-]+$/i;

/** Each part between dots must have something in it and must not start or end with a dash. */
const hostIsSane = (host: string) => host.length <= 253 && host.split(".").every((part) => part !== "" && !part.startsWith("-") && !part.endsWith("-"));

/** What the user typed (xxx.com, https://xxx.com, localhost:4321) as a page origin and a permission pattern. */
export function siteFrom(text: string): { origin: string; pattern: string } | Problem {
  const typed = text.trim();
  const bad = { error: "That is not a site address. Use something like https://xxx.com or localhost:4321" };
  if (typed === "") return bad;
  const local = /^(localhost|127\.0\.0\.1)(:|\/|$)/.test(typed);
  let url: URL;
  try {
    url = new URL(SCHEME.test(typed) ? typed : `${local ? "http" : "https"}://${typed}`);
  } catch {
    return bad;
  }
  const plain = url.pathname === "/" && !url.search && !url.hash && !url.username && !url.password;
  if ((url.protocol !== "http:" && url.protocol !== "https:") || !plain || !HOST_LETTERS.test(url.hostname)) return bad;
  if (!hostIsSane(url.hostname)) return { error: "That site name is not valid. No part of it can be empty or start or end with a dash, and it can be at most 253 characters" };
  return { origin: url.origin, pattern: `${url.protocol}//${url.hostname}/*` };
}

/** The pasted project config as the daemon address and token. */
export function readConfigText(text: string): { daemon: string; token: string } | Problem {
  let config: { port?: unknown; token?: unknown } | null;
  try {
    config = JSON.parse(text);
  } catch {
    return { error: "The config is not JSON. Paste the whole file" };
  }
  const { port, token } = config ?? {};
  if (typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > 65535) return { error: "The config has no port from 1 to 65535" };
  if (typeof token !== "string" || token === "") return { error: "The config has no token" };
  return { daemon: `http://127.0.0.1:${port}`, token };
}

/** True when a saved site still uses this permission pattern. */
export function patternStillUsed(sites: Sites, pattern: string): boolean {
  return Object.keys(sites).some((origin) => {
    const site = siteFrom(origin);
    return "pattern" in site && site.pattern === pattern;
  });
}

/** Pages the extension is on for without a pasted config: it pairs with the daemon itself. file:/// also needs Chrome's "Allow access to file URLs". */
/** The id the page-errors recorder script of a site is registered under. */
export const recorderId = (pattern: string) => `${pattern}#recorder`;

export const LOCAL_PATTERNS = ["http://localhost/*", "http://127.0.0.1/*", "file:///*"];

/** The key a tab's page is saved under: its origin, or file:// for any local file. Nothing for chrome://, about: and a missing address. */
export function siteKey(tabUrl: string | undefined): string | undefined {
  try {
    const url = new URL(tabUrl ?? "");
    if (url.protocol === "file:") return "file://";
    return url.protocol === "http:" || url.protocol === "https:" ? url.origin : undefined;
  } catch {
    return undefined;
  }
}

/** True for file:// and for http://localhost or http://127.0.0.1 on any port. */
export const isLocalKey = (key: string | undefined) => key === "file://" || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(key ?? "");
