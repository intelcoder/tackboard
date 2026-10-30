import { build } from "esbuild";
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { brand } from "@app/shared";
import { emptySharedConfig } from "../overlay/build.ts";
import { LOCAL_PATTERNS } from "./src/sites.ts";

const here = import.meta.dirname;
const ALL_URLS = "<all_urls>";

/** Builds the unpacked extension into `outDir`. `extraHostPermissions` is only for tests that cannot click Chrome's approval box. */
export async function buildExtension(outDir: string, extraHostPermissions: string[] = []): Promise<string> {
  mkdirSync(outDir, { recursive: true });
  await build({
    entryPoints: ["background", "content", "options"].map((name) => join(here, "src", `${name}.ts`)),
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
  const manifest = {
    manifest_version: 3,
    name: brand.name,
    version: "0.1.0",
    key: brand.extensionKey,
    permissions: ["storage", "scripting", "activeTab", "clipboardRead"],
    // <all_urls> is only for screenshots: Chrome will not capture a tab without it. The options page asks for it when the user turns Screenshots on.
    optional_host_permissions: ["http://*/*", "https://*/*", ALL_URLS],
    // Local pages are on from the start (no site to add); the daemon address is 127.0.0.1.
    host_permissions: [...new Set(["http://localhost/*", "http://127.0.0.1/*", ...extraHostPermissions])],
    content_scripts: [{ matches: LOCAL_PATTERNS, js: ["content.js"], run_at: "document_idle", all_frames: true }],
    background: { service_worker: "background.js" },
    action: { default_title: brand.name },
    options_ui: { page: "options.html", open_in_tab: true },
  };
  writeFileSync(join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  return outDir;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  console.log(`wrote ${await buildExtension(join(here, "dist"))}`);
}
