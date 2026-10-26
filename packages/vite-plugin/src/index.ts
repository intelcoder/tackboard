import { relative, sep } from "node:path";
import { brand } from "@app/shared";

/**
 * One scan over the code. Strings, template text and comments are matched first so a tag-like
 * piece inside them is skipped. A host tag is "<" plus a lowercase name, not directly after a
 * word character or a closing bracket (that would be a comparison like i<n or a generic like useState<string>).
 */
const SCAN = new RegExp(
  [
    String.raw`\/\*[\s\S]*?\*\/`,
    String.raw`(?<!:)\/\/[^\n]*`,
    String.raw`(?<![\w$])"(?:[^"\\\n]|\\.)*"`,
    String.raw`(?<![\w$])'(?:[^'\\\n]|\\.)*'`,
    "`(?:[^`\\\\]|\\\\.)*`",
    String.raw`(?<![\w$)\]])<([a-z][\w-]*)(?=[\s/>])`,
  ].join("|"),
  "g",
);

/** Index of the ">" that ends the opening tag, or -1 when the tag does not look complete. */
function openTagEnd(code: string, from: number): number {
  let depth = 0;
  for (let i = from; i < code.length; i++) {
    const c = code[i];
    if (c === '"' || c === "'" || c === "`") {
      const close = code.indexOf(c, i + 1);
      if (close < 0) return -1;
      i = close;
    } else if (c === "{") depth++;
    else if (c === "}") depth--;
    else if (depth === 0 && c === ">") return i;
    else if (depth === 0 && c === "<") return -1;
  }
  return -1;
}

/** Adds the source attribute (file:line) to every lowercase host tag. Anything it does not understand stays as it was. */
export function addSourceAttrs(code: string, relPath: string): string {
  const where = relPath.replace(/"/g, "%22");
  let out = "";
  let copied = 0;
  let line = 1;
  let counted = 0;
  for (const hit of code.matchAll(SCAN)) {
    const name = hit[1];
    if (!name || name === "const") continue;
    const nameEnd = hit.index + 1 + name.length;
    const tagEnd = openTagEnd(code, nameEnd);
    if (tagEnd < 0) continue;
    if (code.slice(nameEnd, tagEnd).includes(`${brand.sourceAttr}=`)) continue;
    for (let i = counted; i < hit.index; i++) if (code[i] === "\n") line++;
    counted = hit.index;
    out += code.slice(copied, nameEnd) + ` ${brand.sourceAttr}="${where}:${line}"`;
    copied = nameEnd;
  }
  return out + code.slice(copied);
}

type PluginResult = { code: string; map: null } | null;

/** A plain Vite plugin object (no import of vite). It runs only under the dev server. */
export function sourceAttrPlugin(): {
  name: string;
  apply: "serve";
  enforce: "pre";
  transform(code: string, id: string): PluginResult;
} {
  return {
    name: "source-attr",
    apply: "serve",
    enforce: "pre",
    transform(code, id) {
      const file = id.split("?")[0] ?? id;
      if (!/\.[jt]sx$/.test(file) || file.includes("/node_modules/")) return null;
      const relPath = relative(process.cwd(), file).split(sep).join("/");
      const changed = addSourceAttrs(code, relPath);
      return changed === code ? null : { code: changed, map: null };
    },
  };
}
