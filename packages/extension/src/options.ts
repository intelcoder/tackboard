import { brand } from "@app/shared";
import { chrome, loadSites, saveSites } from "./chrome_calls.ts";
import { LOCAL_PATTERNS, isLocalKey, recorderId, patternStillUsed, readConfigText, siteFrom, siteKey } from "./sites.ts";

const find = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const list = find("sites");
const form = find<HTMLFormElement>("add");
const siteField = find<HTMLInputElement>("site");
const configField = find<HTMLTextAreaElement>("config");
const problem = find("problem");

document.title = `${brand.name} settings`;
find("title").textContent = `${brand.name} settings`;
find("config_hint").textContent = `Paste the whole ${brand.dataDir}/${brand.configFile} of the project.`;
// The shortcuts are the same keys everywhere; a Mac just calls the key Option.
if (navigator.platform.startsWith("Mac")) for (const key of document.querySelectorAll("kbd")) key.textContent = key.textContent!.replace("Alt", "Option");

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
      const local = isLocalKey(origin);
      const on = element("input", { type: "checkbox" }) as HTMLInputElement;
      on.checked = sites[origin]!.on;
      const tag = element("span", { class: "tag", title: local ? "Pairs with the daemon by itself" : "Added here, with Chrome's permission" }, local ? "Local" : "Added");
      const row = element("li", { class: on.checked ? "" : "off" }, element("span", { class: "site" }, element("span", { class: "address" }, origin), tag));
      on.addEventListener("change", async () => {
        row.classList.toggle("off", !on.checked);
        const saved = await loadSites();
        if (saved[origin]) await saveSites({ ...saved, [origin]: { ...saved[origin], on: on.checked } });
      });
      const remove = element("button", { type: "button", class: "remove", title: local ? "Turns it off. A local page comes back by itself." : "Forgets the site and gives its permission back." }, "Remove");
      remove.addEventListener("click", () => void removeSite(origin));
      row.append(element("span", { class: "actions" }, element("label", {}, on, "On"), remove));
      return row;
    }),
  );
}

async function removeSite(origin: string): Promise<void> {
  const sites = await loadSites();
  const pattern = siteFrom(origin);
  // Local pages are injected by the manifest and come back by themselves, so Remove turns them off and keeps the row.
  if (origin === "file://" || ("pattern" in pattern && LOCAL_PATTERNS.includes(pattern.pattern))) {
    if (sites[origin]) await saveSites({ ...sites, [origin]: { ...sites[origin], on: false } });
    return void (await showSites());
  }
  delete sites[origin];
  await saveSites(sites);
  await showSites();
  const found = siteFrom(origin);
  if (!("pattern" in found) || patternStillUsed(sites, found.pattern)) return;
  // Chrome rejects an id that is not registered, which is fine here.
  await dropScripts(found.pattern);
  await chrome.permissions.remove({ origins: [found.pattern] });
}

// One call per id: Chrome rejects the whole call when any id is not registered (a site added before the recorder existed has no recorder).
async function dropScripts(pattern: string): Promise<void> {
  for (const id of [pattern, recorderId(pattern)]) await chrome.scripting.unregisterContentScripts({ ids: [id] }).catch(() => {});
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
    // The manifest already covers local pages, so only other sites need Chrome's approval and a saved script.
    if (!LOCAL_PATTERNS.includes(site.pattern)) {
      if (!(await chrome.permissions.request({ origins: [site.pattern] }))) throw new Error("refused");
      // allFrames: the overlay also mounts inside iframes of the site, such as Storybook's preview. Re-registering moves older sites onto it too.
      await dropScripts(site.pattern);
      await chrome.scripting.registerContentScripts([
        { id: site.pattern, matches: [site.pattern], js: ["content.js"], runAt: "document_idle", allFrames: true, persistAcrossSessions: true },
        { id: recorderId(site.pattern), matches: [site.pattern], js: ["recorder.js"], runAt: "document_start", allFrames: true, world: "MAIN", persistAcrossSessions: true },
      ]);
    }
    await saveSites({ ...(await loadSites()), [site.origin]: { ...config, on: true } });
  } catch (error) {
    problem.textContent = `Chrome did not allow that site (${error instanceof Error ? error.message : error})`;
    if (!hadIt) await chrome.permissions.remove({ origins: [site.pattern] }).catch(() => {});
    return;
  }
  siteField.value = "";
  configField.value = "";
  await showSites();
});

// The toolbar button sends the address of the page it was clicked on.
const wantedSite = new URLSearchParams(location.search).get("site");
if (wantedSite) {
  siteField.value = wantedSite;
  configField.focus();
  if (isLocalKey(siteKey(wantedSite))) {
    problem.textContent = `No ${brand.name} daemon for this page was found on ports ${brand.pairPort} to ${brand.pairPort + brand.pairSpan - 1} (the daemon's allowed origins must include this page). Run "${brand.cli} start" in your project and click the button again, or paste the config below.`;
  }
  // Fill the config from the clipboard when it holds one, so only the approval click is left.
  void navigator.clipboard.readText().then((text) => {
    if (configField.value === "" && "token" in readConfigText(text)) configField.value = text;
  }).catch(() => {});
}

// Local files need a switch only the user can turn on, on the extension's card.
const fileHint = find("file_hint");
void chrome.extension.isAllowedFileSchemeAccess().then((allowed) => (fileHint.hidden = allowed)).catch(() => {});

void showSites();

// Screenshots: Chrome only captures a tab for an extension that holds <all_urls>, so the user turns that on here, once.
const ALL_URLS = { origins: ["<all_urls>"] };
const shots = find<HTMLInputElement>("shots");
const shotsProblem = find("shots_problem");
void chrome.permissions.contains(ALL_URLS).then((has) => (shots.checked = has));
shots.addEventListener("change", async () => {
  shotsProblem.textContent = "";
  // Chrome only shows its approval box for the click, so nothing slow comes before the request.
  const wanted = shots.checked;
  let why = "";
  const done = wanted
    ? await chrome.permissions.request(ALL_URLS).catch((error: Error) => ((why = error.message), false))
    : !(await chrome.permissions.remove(ALL_URLS).catch(() => false));
  if (wanted && !done) shotsProblem.textContent = `Chrome did not allow screenshots${why ? ` (${why})` : ""}`;
  shots.checked = await chrome.permissions.contains(ALL_URLS);
});
