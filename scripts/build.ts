import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const pkgs = readdirSync(join(root, "packages")).sort();
for (const pkg of pkgs) {
  const script = join(root, "packages", pkg, "build.ts");
  if (!existsSync(script)) continue;
  console.log(`build ${pkg}`);
  try {
    execFileSync("node", [script], { cwd: root, stdio: "inherit" });
  } catch {
    process.exit(1);
  }
}
