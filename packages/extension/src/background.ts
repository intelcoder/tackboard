import { chrome, loadSites, saveSites } from "./chrome_calls.ts";
import { pairSites } from "./discover.ts";
import { answerMessage } from "./proxy.ts";
import type { Sites } from "./sites.ts";
import { LOCAL_PATTERNS, isLocalKey, siteFrom, siteKey } from "./sites.ts";
import { badgeFor, badgeNeedsUpdate, whatClickDoes } from "./toolbar.ts";

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (!sender.tab?.url) return;
  void answer(sender.tab.url, message).then(reply);
  return true;
});

/** Local pages (localhost, 127.0.0.1, file) pair with the daemon on the fixed port, so no config is pasted. Other sites use what the user saved. */
async function answer(url: string, message: { kind: string; method: string; path: string; body?: string }) {
  let sites = await loadSites();
  const local = isLocalKey(siteKey(url));
  const pair = async () => {
    const next = local ? await pairSites(sites, url) : sites;
    if (next !== sites) await saveSites(next);
    sites = next;
  };
  if (local && message.kind === "is_on") await pair();
  const result = await answerMessage(sites, { tab: { url } }, message);
  // A daemon that moved or restarted has a new token: pair again once and retry.
  if (local && typeof result === "object" && "error" in result) {
    await pair();
    return answerMessage(sites, { tab: { url } }, message);
  }
  return result;
}

// The manifest already injects the overlay on these pages, so a script saved for the same pages by an older version would inject it twice.
chrome.scripting.unregisterContentScripts({ ids: LOCAL_PATTERNS }).catch(() => {});

// Tabs of saved sites check again when the saved sites change.
chrome.storage.onChanged.addListener(async (changes) => {
  if (!changes.sites) return;
  const sites = await loadSites();
  const patterns = Object.keys(sites).flatMap((origin) => {
    const site = siteFrom(origin);
    return "pattern" in site ? [site.pattern] : [];
  });
  try {
    if (patterns.length > 0) {
      for (const tab of await chrome.tabs.query({ url: patterns })) {
        if (tab.id !== undefined) chrome.tabs.sendMessage(tab.id, { kind: "changed" }).catch(() => {});
      }
    }
    // Every tab, so a tab of a site that was just removed loses its badge too.
    for (const tab of await chrome.tabs.query({})) showBadge(sites, tab);
  } catch {
    // A tab closed in the meantime.
  }
});

/** Sets the button's words and title for one tab. Chrome keeps them per tab, even after the tab goes to another site, so this runs on every new address or load. */
function showBadge(sites: Sites, tab: { id?: number; url?: string }): void {
  if (tab.id === undefined) return;
  const badge = badgeFor(sites, tab.url);
  const done = [
    chrome.action.setBadgeText({ tabId: tab.id, text: badge.text }),
    chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: badge.color }),
    chrome.action.setBadgeTextColor({ tabId: tab.id, color: "#ffffff" }),
    chrome.action.setTitle({ tabId: tab.id, title: badge.title }),
  ];
  // The tab may have closed in the meantime.
  for (const one of done) one.catch(() => {});
}

chrome.tabs.onUpdated.addListener(async (_tabId, changes, tab) => {
  if (!badgeNeedsUpdate(changes)) return;
  await loadSites().then((sites) => showBadge(sites, tab)).catch(() => {});
});
chrome.tabs.onActivated.addListener(({ tabId }) =>
  chrome.tabs.get(tabId).then(async (tab) => showBadge(await loadSites(), tab)).catch(() => {}),
);

// A click on the button turns a saved site on or off, or opens the setup for a site that is not added.
chrome.action.onClicked.addListener(async (tab) => {
  let sites = await loadSites();
  // A local page that is not saved yet pairs with the daemon right here, so there is no setup to open. The click is the permission to put the bar in this tab now, with no reload.
  if (tab.url && isLocalKey(siteKey(tab.url)) && !sites[siteKey(tab.url)!]) {
    const paired = await pairSites(sites, tab.url);
    if (paired !== sites) {
      await saveSites(paired);
      if (tab.id !== undefined) await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files: ["content.js"] }).catch(() => {});
      return;
    }
  }
  const click = whatClickDoes(sites, tab.url);
  if (click.kind === "flip") return saveSites({ ...sites, [click.origin]: { ...sites[click.origin]!, on: click.on } });
  const query = click.site ? `?site=${encodeURIComponent(click.site)}` : "";
  await chrome.tabs.create({ url: chrome.runtime.getURL("options.html") + query });
});
