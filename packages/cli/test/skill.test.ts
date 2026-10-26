import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { brand } from "@app/shared";

const MAIN = join(import.meta.dirname, "../src/main.ts");
const SKILL = join(import.meta.dirname, `../../../skills/${brand.cli}/SKILL.md`);

function usage_commands(): string[] {
  // With no command the CLI prints its usage text and exits 1.
  const out = spawnSync("node", [MAIN], { cwd: tmpdir(), encoding: "utf8" }).stdout;
  return out
    .split("\n")
    .filter((line) => line.startsWith("  "))
    .map((line) => line.trim().split(" ")[0]!);
}

test("the skill has a name and a description in its frontmatter", () => {
  const text = readFileSync(SKILL, "utf8");
  const front = /^---\n([\s\S]*?)\n---\n/.exec(text);
  assert.ok(front, "no frontmatter");
  assert.match(front[1]!, new RegExp(`^name: ${brand.cli}$`, "m"));
  assert.match(front[1]!, /^description: \S.*$/m);
});

test("every command in the usage text appears in the skill", () => {
  const commands = usage_commands();
  assert.ok(commands.length >= 10, commands.join(","));
  const text = readFileSync(SKILL, "utf8");
  for (const name of commands) {
    assert.ok(text.includes(`${brand.cli} ${name}`), `skill is missing: ${name}`);
  }
});
