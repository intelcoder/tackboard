/**
 * Is a thread's page the one an agent asked for? `want` is a path ("/pricing") or a whole address.
 * A hash and a trailing slash do not count; a thread with no page never matches.
 */
export function onPage(threadUrl: string, want: string): boolean {
  const bare = (u: string) => u.replace(/#.*$/, "").replace(/\/$/, "");
  if (!threadUrl) return false;
  if (!want.startsWith("/")) return bare(threadUrl) === bare(want);
  try {
    return bare(new URL(threadUrl).pathname) === bare(want.replace(/\?.*$/, ""));
  } catch {
    return false;
  }
}
