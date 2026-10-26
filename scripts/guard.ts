import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { brand } from "../packages/shared/src/brand.ts";

export type Violation = { path: string; rule: "brand" | "sink"; form: string };

const SINKS: { form: string; re: RegExp }[] = [
  { form: "innerHTML", re: /innerHTML/ },
  { form: "outerHTML", re: /\.outerHTML\s*=(?!=)/ },
  { form: "insertAdjacentHTML", re: /insertAdjacentHTML/ },
  { form: "document.write", re: /document\s*\.\s*write/ },
  { form: "createContextualFragment", re: /createContextualFragment/ },
  { form: "DOMParser", re: /DOMParser/ },
  { form: "setHTMLUnsafe", re: /setHTMLUnsafe/ },
  { form: "srcdoc", re: /srcdoc/ },
];

const BRAND_FILE = "packages/shared/src/brand.ts";
const norm = (p: string) => p.split("\\").join("/");
const isTestDir = (p: string) => /(^|\/)(test|test-support)\//.test(p);

function brandScope(p: string): boolean {
  return (
    /^packages\/[^/]+\/src\//.test(p) ||
    p.startsWith("scripts/") ||
    p.startsWith("e2e/fixtures/") ||
    p === "e2e/playwright.config.ts"
  );
}

export function findViolations(files: { path: string; text: string }[]): Violation[] {
  const out: Violation[] = [];
  const name = brand.name.toLowerCase();
  for (const f of files) {
    const path = norm(f.path);
    if (isTestDir(path)) continue;
    if (path !== BRAND_FILE && brandScope(path)) {
      const squashed = f.text.toLowerCase().replace(/["'`+\s]/g, "");
      if (squashed.includes(name)) out.push({ path, rule: "brand", form: "product name" });
    }
    if (path.startsWith("packages/overlay/src/")) {
      for (const s of SINKS) if (s.re.test(f.text)) out.push({ path, rule: "sink", form: s.form });
    }
  }
  return out;
}

const TEXT_EXT = /\.(ts|tsx|html|css|json)$/;
const SKIP = new Set(["node_modules", "dist", "artifacts"]);

function walk(root: string, dir: string, acc: { path: string; text: string }[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const e of entries) {
    if (SKIP.has(e)) continue;
    const full = join(dir, e);
    if (statSync(full).isDirectory()) walk(root, full, acc);
    else if (TEXT_EXT.test(e)) {
      acc.push({ path: relative(root, full).split(sep).join("/"), text: readFileSync(full, "utf8") });
    }
  }
}

export function scanTree(root: string): Violation[] {
  const files: { path: string; text: string }[] = [];
  walk(root, join(root, "packages"), files);
  walk(root, join(root, "scripts"), files);
  walk(root, join(root, "e2e"), files);
  return findViolations(files);
}

if (process.argv[1] && norm(process.argv[1]).endsWith("scripts/guard.ts")) {
  const v = scanTree(join(import.meta.dirname, ".."));
  for (const x of v) console.log(`${x.path}: ${x.rule} (${x.form})`);
  process.exit(v.length ? 1 : 0);
}
