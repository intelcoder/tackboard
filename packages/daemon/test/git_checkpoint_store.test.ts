import { test, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { brand } from "@app/shared";
import { GitCheckpointStore } from "../src/infrastructure/git_checkpoint_store.ts";
import { git } from "./daemon_setup.ts";

const folders: string[] = [];
after(() => {
  for (const f of folders) rmSync(f, { recursive: true, force: true });
});

function write(dir: string, name: string, text: string): void {
  const full = join(dir, name);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, text);
}

function make_repo(): string {
  const dir = mkdtempSync(join(tmpdir(), "ckpt-"));
  folders.push(dir);
  git(dir, "init", "-q", "-b", "main");
  write(dir, ".gitignore", "ignored.txt\n.tackboard/\n");
  write(dir, "a.txt", "a1\n");
  write(dir, "b.txt", "b1\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "first");
  return dir;
}

test("snapshot does not change HEAD, the index, or git status output", () => {
  const dir = make_repo();
  write(dir, "a.txt", "a2\n");
  write(dir, "new.txt", "n\n");
  git(dir, "add", "b.txt");
  const before = [git(dir, "rev-parse", "HEAD"), git(dir, "status", "--porcelain"), git(dir, "ls-files", "-s"), git(dir, "stash", "list")];
  const id = new GitCheckpointStore(dir).snapshot("one");
  const after_ = [git(dir, "rev-parse", "HEAD"), git(dir, "status", "--porcelain"), git(dir, "ls-files", "-s"), git(dir, "stash", "list")];
  assert.deepEqual(after_, before);
  assert.match(id, /^[0-9a-f]{40}$/);
  const refs = git(dir, "for-each-ref", "--format=%(refname)").trim().split("\n");
  assert.ok(refs.some((r) => r.startsWith(brand.refPrefix)));
  assert.ok(refs.every((r) => r.startsWith(brand.refPrefix) || r.startsWith("refs/heads/")));
});

test("restore returns modified, untracked and deleted files to the snapshot state", () => {
  const dir = make_repo();
  const store = new GitCheckpointStore(dir);
  write(dir, "a.txt", "a-modified\n");
  write(dir, "untracked.txt", "u\n");
  write(dir, "sub/deep.txt", "d\n");
  rmSync(join(dir, "b.txt"));
  const id = store.snapshot("dirty");
  write(dir, "a.txt", "a-later\n");
  rmSync(join(dir, "untracked.txt"));
  write(dir, "b.txt", "b-back\n");
  write(dir, "extra.txt", "x\n");
  write(dir, "sub/more.txt", "m\n");
  git(dir, "add", "extra.txt");
  store.restore(id);
  assert.equal(readFileSync(join(dir, "a.txt"), "utf8"), "a-modified\n");
  assert.equal(readFileSync(join(dir, "untracked.txt"), "utf8"), "u\n");
  assert.equal(readFileSync(join(dir, "sub/deep.txt"), "utf8"), "d\n");
  assert.equal(existsSync(join(dir, "b.txt")), false);
  assert.equal(existsSync(join(dir, "extra.txt")), false);
  assert.equal(existsSync(join(dir, "sub/more.txt")), false);
  // the real index is reset to HEAD: nothing staged
  assert.equal(git(dir, "diff", "--cached", "--name-only"), "");
  assert.equal(store.hasChangedSince(id), false);
});

test("restore leaves ignored.txt and the data directory untouched", () => {
  const dir = make_repo();
  const store = new GitCheckpointStore(dir);
  write(dir, "ignored.txt", "secret\n");
  write(dir, `${brand.dataDir}/keep.db`, "db\n");
  const id = store.snapshot("s");
  write(dir, "ignored.txt", "changed\n");
  write(dir, `${brand.dataDir}/keep.db`, "db2\n");
  write(dir, `${brand.dataDir}/new.log`, "log\n");
  write(dir, "a.txt", "a-later\n");
  store.restore(id);
  assert.equal(readFileSync(join(dir, "ignored.txt"), "utf8"), "changed\n");
  assert.equal(readFileSync(join(dir, brand.dataDir, "keep.db"), "utf8"), "db2\n");
  assert.equal(readFileSync(join(dir, brand.dataDir, "new.log"), "utf8"), "log\n");
  assert.equal(readFileSync(join(dir, "a.txt"), "utf8"), "a1\n");
  const tree = git(dir, "ls-tree", "-r", "--name-only", id);
  assert.ok(!tree.includes("ignored.txt"));
  assert.ok(!tree.includes(brand.dataDir));
});

test("data directory is excluded even when it is not in .gitignore", () => {
  const dir = make_repo();
  write(dir, ".gitignore", "ignored.txt\n");
  git(dir, "commit", "-q", "-am", "ignore");
  write(dir, `${brand.dataDir}/x.db`, "1\n");
  const store = new GitCheckpointStore(dir);
  const id = store.snapshot("s");
  assert.ok(!git(dir, "ls-tree", "-r", "--name-only", id).includes(brand.dataDir));
  write(dir, "a.txt", "changed\n");
  store.restore(id);
  assert.equal(readFileSync(join(dir, brand.dataDir, "x.db"), "utf8"), "1\n");
});

test("untracked non-ignored files added after the snapshot are removed on restore, ignored ones are kept", () => {
  const dir = make_repo();
  const store = new GitCheckpointStore(dir);
  const id = store.snapshot("clean");
  write(dir, "late.txt", "l\n");
  write(dir, "ignored.txt", "i\n");
  store.restore(id);
  assert.equal(existsSync(join(dir, "late.txt")), false);
  assert.equal(readFileSync(join(dir, "ignored.txt"), "utf8"), "i\n");
});

test("hasChangedSince is false right after snapshot and true after editing a file", () => {
  const dir = make_repo();
  const store = new GitCheckpointStore(dir);
  write(dir, "u.txt", "u\n");
  const id = store.snapshot("s");
  assert.equal(store.hasChangedSince(id), false);
  write(dir, "a.txt", "edited\n");
  assert.equal(store.hasChangedSince(id), true);
  write(dir, "a.txt", "a1\n");
  assert.equal(store.hasChangedSince(id), false);
});

test("changedFiles lists paths between two snapshots", () => {
  const dir = make_repo();
  const store = new GitCheckpointStore(dir);
  const first = store.snapshot("one");
  write(dir, "a.txt", "a2\n");
  write(dir, "dir/new.txt", "n\n");
  rmSync(join(dir, "b.txt"));
  const second = store.snapshot("two");
  assert.deepEqual(store.changedFiles(first, second).sort(), ["a.txt", "b.txt", "dir/new.txt"]);
  assert.deepEqual(store.changedFiles(first, first), []);
});

test("works on a branch name with a slash and on detached HEAD", () => {
  const dir = make_repo();
  git(dir, "checkout", "-q", "-b", "feature/pricing");
  const store = new GitCheckpointStore(dir);
  write(dir, "a.txt", "slash\n");
  const id = store.snapshot("slash");
  write(dir, "a.txt", "later\n");
  store.restore(id);
  assert.equal(readFileSync(join(dir, "a.txt"), "utf8"), "slash\n");
  assert.equal(git(dir, "rev-parse", "--abbrev-ref", "HEAD").trim(), "feature/pricing");

  git(dir, "checkout", "-q", "--detach");
  const head = git(dir, "rev-parse", "HEAD");
  write(dir, "a.txt", "detached\n");
  const id2 = store.snapshot("detached");
  write(dir, "a.txt", "later\n");
  store.restore(id2);
  assert.equal(readFileSync(join(dir, "a.txt"), "utf8"), "detached\n");
  assert.equal(git(dir, "rev-parse", "HEAD"), head);
  assert.equal(git(dir, "rev-parse", "--abbrev-ref", "HEAD").trim(), "HEAD");
});

test("snapshot ids are unique and refs stay under the ref prefix", () => {
  const dir = make_repo();
  const store = new GitCheckpointStore(dir);
  const one = store.snapshot("one");
  const two = store.snapshot("two");
  assert.notEqual(one, two);
  const refs = git(dir, "for-each-ref", "--format=%(refname)", brand.refPrefix).trim().split("\n");
  assert.equal(refs.length, 2);
});

test("a repository with no commits can be snapshotted and restored", () => {
  const dir = mkdtempSync(join(tmpdir(), "ckpt-"));
  folders.push(dir);
  git(dir, "init", "-q", "-b", "main");
  write(dir, "a.txt", "a\n");
  const store = new GitCheckpointStore(dir);
  const id = store.snapshot("empty repo");
  write(dir, "a.txt", "changed\n");
  write(dir, "b.txt", "b\n");
  store.restore(id);
  assert.equal(readFileSync(join(dir, "a.txt"), "utf8"), "a\n");
  assert.equal(existsSync(join(dir, "b.txt")), false);
});

test("outside a git repository snapshot throws no_git", () => {
  const dir = mkdtempSync(join(tmpdir(), "ckpt-"));
  folders.push(dir);
  const store = new GitCheckpointStore(dir);
  assert.throws(() => store.snapshot("x"), (e: unknown) => (e as { code?: string }).code === "no_git");
});

test("a tracked file that matches .gitignore is kept by restore and snapshotted", () => {
  const dir = make_repo();
  write(dir, "ign.txt", "forced\n");
  git(dir, "add", "-f", "ign.txt");
  git(dir, "commit", "-q", "-m", "force add");
  const store = new GitCheckpointStore(dir);
  write(dir, "ign.txt", "edited\n");
  const id = store.snapshot("s");
  assert.ok(git(dir, "ls-tree", "-r", "--name-only", id).includes("ign.txt"));
  write(dir, "ign.txt", "later\n");
  store.restore(id);
  assert.equal(readFileSync(join(dir, "ign.txt"), "utf8"), "edited\n");
  // a tracked ignored file added after the snapshot is also left alone
  write(dir, "ign2.txt", "x\n");
  git(dir, "add", "-f", "ign2.txt");
  ignore_line(dir, "ign2.txt");
  store.restore(id);
  assert.equal(readFileSync(join(dir, "ign2.txt"), "utf8"), "x\n");
});

function ignore_line(dir: string, name: string): void {
  writeFileSync(join(dir, ".git", "info", "exclude"), `${name}\n`, { flag: "a" });
}

test("restore works when a file became a directory", () => {
  const dir = make_repo();
  write(dir, "thing", "file\n");
  const store = new GitCheckpointStore(dir);
  const id = store.snapshot("file");
  rmSync(join(dir, "thing"));
  write(dir, "thing/inner.txt", "i\n");
  write(dir, "thing/deeper/more.txt", "m\n");
  git(dir, "add", "-A");
  store.restore(id);
  assert.equal(readFileSync(join(dir, "thing"), "utf8"), "file\n");
  assert.equal(git(dir, "diff", "--cached", "--name-only"), "");
});

test("restore works when a directory became a file", () => {
  const dir = make_repo();
  write(dir, "thing/inner.txt", "i\n");
  const store = new GitCheckpointStore(dir);
  const id = store.snapshot("dir");
  rmSync(join(dir, "thing"), { recursive: true });
  write(dir, "thing", "now a file\n");
  store.restore(id);
  assert.equal(readFileSync(join(dir, "thing/inner.txt"), "utf8"), "i\n");
});

test("a nested repository with no commits does not break snapshot or restore", () => {
  const dir = make_repo();
  mkdirSync(join(dir, "inner"));
  git(join(dir, "inner"), "init", "-q");
  write(dir, "inner/file.txt", "n\n");
  const store = new GitCheckpointStore(dir);
  write(dir, "a.txt", "a-saved\n");
  const id = store.snapshot("nested");
  assert.ok(!git(dir, "ls-tree", "-r", "--name-only", id).includes("inner"));
  write(dir, "a.txt", "later\n");
  store.restore(id);
  assert.equal(readFileSync(join(dir, "a.txt"), "utf8"), "a-saved\n");
  assert.equal(readFileSync(join(dir, "inner/file.txt"), "utf8"), "n\n");
  assert.equal(store.hasChangedSince(id), false);
});

test("snapshot ids are not reused after a ref is deleted", () => {
  const dir = make_repo();
  const store = new GitCheckpointStore(dir);
  store.snapshot("one");
  write(dir, "a.txt", "2\n");
  const two = store.snapshot("two");
  write(dir, "a.txt", "3\n");
  const three = store.snapshot("three");
  git(dir, "update-ref", "-d", `${brand.refPrefix}1`);
  write(dir, "a.txt", "4\n");
  const four = store.snapshot("four");
  const refs = git(dir, "for-each-ref", "--format=%(refname) %(objectname)", brand.refPrefix).trim().split("\n");
  assert.deepEqual(refs.sort(), [`${brand.refPrefix}2 ${two}`, `${brand.refPrefix}3 ${three}`, `${brand.refPrefix}4 ${four}`]);
});

test("restore removes folders it emptied but keeps folders that were already empty or hold ignored files", () => {
  const dir = make_repo();
  mkdirSync(join(dir, "already_empty"));
  const store = new GitCheckpointStore(dir);
  const id = store.snapshot("s");
  write(dir, "late/sub/x.txt", "x\n");
  write(dir, "mixed/new.txt", "n\n");
  write(dir, "mixed/ignored.txt", "i\n");
  store.restore(id);
  assert.equal(existsSync(join(dir, "late")), false);
  assert.equal(existsSync(join(dir, "already_empty")), true);
  assert.equal(existsSync(join(dir, "mixed/new.txt")), false);
  assert.equal(existsSync(join(dir, "mixed/ignored.txt")), true);
});

test("restore and hasChangedSince outside a git repository throw no_git", () => {
  const dir = mkdtempSync(join(tmpdir(), "ckpt-"));
  folders.push(dir);
  const store = new GitCheckpointStore(dir);
  const is_no_git = (e: unknown) => (e as { code?: string }).code === "no_git";
  assert.throws(() => store.restore("0123456789abcdef0123456789abcdef01234567"), is_no_git);
  assert.throws(() => store.hasChangedSince("0123456789abcdef0123456789abcdef01234567"), is_no_git);
  assert.throws(() => store.changedFiles("a".repeat(40), "b".repeat(40)), is_no_git);
});
