// Builds the npm package into release/: one bin.js (the CLI), daemon.js, the overlay, the skill and the unpacked extension.
// Try it: npm run release, then npm pack ./release, then npm i -g the .tgz it makes.
import { build } from "esbuild";
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { brand } from "../packages/shared/src/brand.ts";
import { buildExtension } from "../packages/extension/build.ts";
import { buildOverlay } from "../packages/overlay/build.ts";

const root = join(import.meta.dirname, "..");
const out = join(root, "release");
rmSync(out, { recursive: true, force: true });
mkdirSync(out);

// node:sqlite and the other node: modules stay external; hono and the workspace packages are bundled in.
// The banner gives the ESM bundle a require, which a few bundled CommonJS pieces still call.
const node = { bundle: true, platform: "node", format: "esm", target: "node22", logLevel: "warning", banner: { js: `import { createRequire as __r } from "node:module"; const require = __r(import.meta.url);` } } as const;
await build({ ...node, entryPoints: { bin: join(root, "packages/cli/src/main.ts") }, outdir: out });
await build({ ...node, entryPoints: { daemon: join(root, "packages/daemon/src/interface/main.ts") }, outdir: out });
await buildOverlay(out);
await buildExtension(join(out, "extension"));
cpSync(join(root, "skills"), join(out, "skills"), { recursive: true });
cpSync(join(root, "README.md"), join(out, "README.md"));

writeFileSync(
  join(out, "package.json"),
  JSON.stringify({ name: brand.cli, version: "0.1.0", description: "Click an element on your dev site, comment, and let your coding agent make the change.", type: "module", bin: { [brand.cli]: "bin.js" }, engines: { node: ">=22.13" }, files: ["bin.js", "daemon.js", `${brand.bundle}`, "extension", "skills", "README.md"], license: "UNLICENSED", repository: `github:intelcoder/${brand.cli}` }, null, 2) + "\n",
);
console.log(`wrote ${out}`);
