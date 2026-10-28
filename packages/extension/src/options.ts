import { brand } from "@app/shared";
import { chrome, loadSites, saveSites } from "./chrome_calls.ts";
import { patternStillUsed, readConfigText, siteFrom } from "./sites.ts";

const find = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const list = find("sites");
const form = find<HTMLFormElement>("add");
const siteField = find<HTMLInputElement>("site");
const configField = find<HTMLTextAreaElement>("config");
const problem = find("problem");

document.title = `${brand.name} sites`;
find("title").textContent = `${brand.name} sites`;
find("config_label").textContent = `Config (paste the project's ${brand.dataDir}/${brand.configFile})`;

function element(tag: string, props: Record<string, string> = {}, ...children: (Node | string)[]): HTMLElement {
  const made = document.createElement(tag);
  for (const [name, value] of Object.entries(props)) made.setAttribute(name, value);
  made.append(...children);
  return made;
}

async function showSites(): Promise<void> {
  const sites = await loadSites();
  const origins = Object.keys(sites);
  if (origins.length === 0) {
    list.replaceChildren(element("li", { class: "empty" }, "No sites yet."));
    return;
  }
  list.replaceChildren(
    ...origins.map((origin) => {
      const on = element("input", { type: "checkbox" }) as HTMLInputElement;
      on.checked = sites[origin]!.on;
      on.addEventListener("change", async () => {
        const saved = await loadSites();
        if (saved[origin]) await saveSites({ ...saved, [origin]: { ...saved[origin], on: on.checked } });
      });
      const remove = element("button", { type: "button" }, "Remove");
      remove.addEventListener("click", () => void removeSite(origin));
      return element("li", {}, element("span", { class: "address" }, origin), element("label", {}, on, "On"), remove);
    }),
  );
}

async function removeSite(origin: string): Promise<void> {
  const sites = await loadSites();
  delete sites[origin];
  await saveSites(sites);
  await showSites();
  const found = siteFrom(origin);
  if (!("pattern" in found) || patternStillUsed(sites, found.pattern)) return;
  await chrome.scripting.unregisterContentScripts({ ids: [found.pattern] });
  await chrome.permissions.remove({ origins: [found.pattern] });
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  problem.textContent = "";
  const site = siteFrom(siteField.value);
  const config = readConfigText(configField.value);
  if ("error" in site) return void (problem.textContent = site.error);
  if ("error" in config) return void (problem.textContent = config.error);
  // Chrome only shows its approval box for the click, so nothing slow comes before the request.
  const hadIt = await chrome.permissions.contains({ origins: [site.pattern] });
  try {
    if (!(await chrome.permissions.request({ origins: [site.pattern] }))) throw new Error("refused");
    if ((await chrome.scripting.getRegisteredContentScripts({ ids: [site.pattern] })).length === 0) {
      await chrome.scripting.registerContentScripts([
        { id: site.pattern, matches: [site.pattern], js: ["content.js"], runAt: "document_idle", persistAcrossSessions: true },
      ]);
    }
    await saveSites({ ...(await loadSites()), [site.origin]: { ...config, on: true } });
  } catch {
    problem.textContent = "Chrome did not allow that site";
    if (!hadIt) await chrome.permissions.remove({ origins: [site.pattern] }).catch(() => {});
    return;
  }
  siteField.value = "";
  configField.value = "";
  await showSites();
});

void showSites();
