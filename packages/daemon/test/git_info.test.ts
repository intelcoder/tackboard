import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GitInfoReader } from "../src/infrastructure/git_info.ts";
import { git } from "./daemon_setup.ts";

const folders: string[] = [];
after(() => {
  for (const f of folders) rmSync(f, { recursive: true, force: true });
});

test("GitInfo reports branch, commit and branches; no-git outside a repository", () => {
  const dir = mkdtempSync(join(tmpdir(), "info-"));
  folders.push(dir);
  const outside = new GitInfoReader(dir);
  assert.equal(outside.branch().value, "no-git");
  assert.equal(outside.commit().value, "0000000");
  assert.deepEqual(outside.branches(), []);

  git(dir, "init", "-q", "-b", "main");
  const empty = new GitInfoReader(dir);
  assert.equal(empty.branch().value, "main");
  assert.equal(empty.commit().value, "0000000");
  assert.deepEqual(empty.branches(), []);

  writeFileSync(join(dir, "a.txt"), "a\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "first");
  git(dir, "branch", "feature/pricing");
  const info = new GitInfoReader(dir);
  assert.equal(info.branch().value, "main");
  assert.equal(info.commit().value, git(dir, "rev-parse", "--short", "HEAD").trim());
  assert.deepEqual(info.branches().sort(), ["feature/pricing", "main"]);

  git(dir, "checkout", "-q", "feature/pricing");
  assert.equal(info.branch().value, "feature/pricing");
  git(dir, "checkout", "-q", "--detach");
  assert.equal(info.branch().value, "HEAD");
});
