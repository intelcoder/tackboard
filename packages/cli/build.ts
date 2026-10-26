import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { brand } from "../shared/src/brand.ts";

const pkgPath = join(import.meta.dirname, "package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
pkg.bin = { [brand.cli]: "./src/main.ts" };
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
chmodSync(join(import.meta.dirname, "src/main.ts"), 0o755);
