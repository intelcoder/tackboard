import { build } from "esbuild";
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { brand } from "@app/shared";
import { emptySharedConfig } from "../overlay/build.ts";
import { LOCAL_PATTERNS } from "./src/sites.ts";

const here = import.meta.dirname;
const ALL_URLS = "<all_urls>";
/** The one place the version lives: the manifest and the npm package (scripts/release.ts) both read it. */
export const VERSION = "0.3.0";
const ICONS = { 16: "icons/16.png", 48: "icons/48.png", 128: "icons/128.png" };

/** Builds the unpacked extension into `outDir`. `extraHostPermissions` is only for tests that cannot click Chrome's approval box. */
export async function buildExtension(outDir: string, extraHostPermissions: string[] = []): Promise<string> {
  mkdirSync(outDir, { recursive: true });
  await build({
    entryPoints: ["background", "content", "options", "recorder"].map((name) => join(here, "src", `${name}.ts`)),
    outdir: outDir,
    bundle: true,
    format: "iife",
    target: "es2022",
    platform: "browser",
    legalComments: "none",
    logLevel: "warning",
    plugins: [emptySharedConfig],
  });
  copyFileSync(join(here, "src", "options.html"), join(outDir, "options.html"));
  mkdirSync(join(outDir, "icons"), { recursive: true });
  for (const size of Object.keys(ICONS)) copyFileSync(join(here, "icons", `${size}.png`), join(outDir, "icons", `${size}.png`));
  const manifest = {
    manifest_version: 3,
    name: brand.name,
    description: "Click an element on your dev site, comment, and let your coding agent make the change.",
    version: VERSION,
    minimum_chrome_version: "111", // the world: "MAIN" content script needs it
    icons: ICONS,
    key: brand.extensionKey,
    permissions: ["storage", "scripting", "activeTab", "clipboardRead"],
    // <all_urls> is only for screenshots: Chrome will not capture a tab without it. The options page asks for it when the user turns Screenshots on.
    optional_host_permissions: ["http://*/*", "https://*/*", ALL_URLS],
    // Local pages are on from the start (no site to add); the daemon address is 127.0.0.1.
    host_permissions: [...new Set(["http://localhost/*", "http://127.0.0.1/*", ...extraHostPermissions])],
    content_scripts: [
      { matches: LOCAL_PATTERNS, js: ["content.js"], run_at: "document_idle", all_frames: true },
      // In the page's own world and from the start, so it sees errors the page raises while loading.
      { matches: LOCAL_PATTERNS, js: ["recorder.js"], run_at: "document_start", all_frames: true, world: "MAIN" },
    ],
    background: { service_worker: "background.js" },
    action: { default_title: brand.name, default_icon: ICONS },
    options_ui: { page: "options.html", open_in_tab: true },
  };
  writeFileSync(join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  return outDir;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  console.log(`wrote ${await buildExtension(join(here, "dist"))}`);
}
