import { chrome, loadSites } from "./chrome_calls.ts";
import { answerMessage } from "./proxy.ts";
import { siteFrom } from "./sites.ts";

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
  if (patterns.length === 0) return;
  for (const tab of await chrome.tabs.query({ url: patterns })) {
    if (tab.id !== undefined) chrome.tabs.sendMessage(tab.id, { kind: "changed" }).catch(() => {});
  }
});
