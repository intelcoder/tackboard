import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { brand } from "./brand.ts";
import type { ProjectConfig } from "./types.ts";

export function configPath(dir: string): string {
  return join(dir, brand.dataDir, brand.configFile);
}

export function readConfig(dir: string): ProjectConfig {
  return JSON.parse(readFileSync(configPath(dir), "utf8")) as ProjectConfig;
}

export function writeConfig(dir: string, config: ProjectConfig): void {
  mkdirSync(join(dir, brand.dataDir), { recursive: true });
  writeFileSync(configPath(dir), JSON.stringify(config, null, 2) + "\n");
}

export function findConfig(startDir: string): { dir: string; config: ProjectConfig } | null {
  let dir = resolve(startDir);
  for (;;) {
    if (existsSync(configPath(dir))) return { dir, config: readConfig(dir) };
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}
