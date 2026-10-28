import { chrome, loadSites, saveSites } from "./chrome_calls.ts";
import { answerMessage } from "./proxy.ts";
import type { Sites } from "./sites.ts";
import { siteFrom } from "./sites.ts";
import { badgeFor, whatClickDoes } from "./toolbar.ts";

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (!sender.tab?.url) return;
  void loadSites().then(async (sites) => reply(await answerMessage(sites, { tab: { url: sender.tab!.url! } }, message)));
  return true;
});

// Tabs of saved sites check again when the saved sites change.
chrome.storage.onChanged.addListener(async (changes) => {
  if (!changes.sites) return;
  const patterns = Object.keys(await loadSites()).flatMap((origin) => {
    const site = siteFrom(origin);
    return "pattern" in site ? [site.pattern] : [];
  });
  if (patterns.length > 0) {
    for (const tab of await chrome.tabs.query({ url: patterns })) {
      if (tab.id !== undefined) chrome.tabs.sendMessage(tab.id, { kind: "changed" }).catch(() => {});
    }
  }
  // Every tab, so a tab of a site that was just removed loses its badge too.
  const sites = await loadSites();
  for (const tab of await chrome.tabs.query({})) showBadge(sites, tab);
});

/** Sets the button's words and title for one tab. Chrome keeps them per tab, even after the tab goes to another site, so this runs on every update. */
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

chrome.tabs.onUpdated.addListener(async (_tabId, _changes, tab) => showBadge(await loadSites(), tab));
chrome.tabs.onActivated.addListener(async ({ tabId }) => showBadge(await loadSites(), await chrome.tabs.get(tabId)));

// A click on the button turns a saved site on or off, or opens the setup for a site that is not added.
chrome.action.onClicked.addListener(async (tab) => {
  const sites = await loadSites();
  const click = whatClickDoes(sites, tab.url);
  if (click.kind === "flip") return saveSites({ ...sites, [click.origin]: { ...sites[click.origin]!, on: click.on } });
  const query = click.site ? `?site=${encodeURIComponent(click.site)}` : "";
  await chrome.tabs.create({ url: chrome.runtime.getURL("options.html") + query });
});
