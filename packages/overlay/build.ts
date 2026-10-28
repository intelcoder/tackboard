import { build } from "esbuild";
import type { Plugin } from "esbuild";
import { join, resolve } from "node:path";
import { brand } from "@app/shared";

const here = import.meta.dirname;

// @app/shared also holds node-only helpers (config.ts imports node:fs). The overlay never
// uses them, so the browser bundle sees that one module as empty.
export const emptySharedConfig: Plugin = {
  name: "empty-shared-config",
  setup(b) {
    b.onLoad({ filter: /shared[\\/]src[\\/]config\.ts$/ }, () => ({ contents: "export {};", loader: "ts" }));
  },
};

export async function buildOverlay(outDir: string): Promise<string> {
  const outfile = join(outDir, brand.bundle);
  await build({
    entryPoints: [join(here, "src", "index.ts")],
    outfile,
    bundle: true,
    format: "iife",
    target: "es2022",
    platform: "browser",
    legalComments: "none",
    logLevel: "warning",
    plugins: [emptySharedConfig],
  });
  return outfile;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const out = await buildOverlay(join(here, "dist"));
  console.log(`wrote ${out}`);
}
