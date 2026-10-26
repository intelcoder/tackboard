import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { build } from "esbuild";
import type { Plugin } from "esbuild";
import { addSourceAttrs } from "@app/vite-plugin";

const here = import.meta.dirname;

/** An esbuild plugin that runs the same code change the dev plugin makes, so it is tried end to end without Vite. */
function addSourceLocations(): Plugin {
  return {
    name: "add-source-locations",
    setup(b) {
      b.onLoad({ filter: /\.tsx$/ }, (args) => {
        const code = readFileSync(args.path, "utf8");
        const where = relative(here, args.path).split("\\").join("/");
        return { contents: addSourceAttrs(code, where), loader: "tsx" };
      });
    },
  };
}

/** Bundles the React fixture into `<folder>/app.js` (React development build, not minified). */
export async function buildReactSite(folder: string, withSourceLocations: boolean): Promise<void> {
  await build({
    entryPoints: [join(here, "src", "main.tsx")],
    outfile: join(folder, "app.js"),
    bundle: true,
    format: "iife",
    jsx: "automatic",
    minify: false,
    define: { "process.env.NODE_ENV": '"development"' },
    plugins: withSourceLocations ? [addSourceLocations()] : [],
    logLevel: "silent",
  });
}
