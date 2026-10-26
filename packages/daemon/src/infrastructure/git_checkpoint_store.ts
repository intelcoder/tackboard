import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdtempSync, readdirSync, rmdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { brand } from "@app/shared";
import { DomainError } from "../domain/errors.ts";
import type { CheckpointStore } from "../domain/checkpoint_store.ts";

/**
 * Checkpoints are commits kept under brand.refPrefix. They are built with a
 * temporary index file, so HEAD, the real index, the stash and branches are never touched
 * while saving.
 */
export class GitCheckpointStore implements CheckpointStore {
  private dir: string;
  constructor(dir: string) {
    this.dir = dir;
  }

  private git(args: string[], extra_env: Record<string, string> = {}, input?: string): string {
    try {
      return execFileSync("git", args, {
        cwd: this.dir,
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: "checkpoint",
          GIT_AUTHOR_EMAIL: "checkpoint@localhost",
          GIT_COMMITTER_NAME: "checkpoint",
          GIT_COMMITTER_EMAIL: "checkpoint@localhost",
          ...extra_env,
        },
        encoding: "utf8",
        input,
        maxBuffer: 256 * 1024 * 1024,
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (e) {
      const err = e as { stderr?: string; message: string };
      if (!this.inside_repo()) throw new DomainError("no_git", "this project is not a git repository");
      throw new Error(`git ${args[0]} failed: ${err.stderr || err.message}`);
    }
  }

  private inside_repo(): boolean {
    try {
      execFileSync("git", ["rev-parse", "--git-dir"], { cwd: this.dir, stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  }

  /** Runs `work` with the path of a fresh temporary index file, then removes it. */
  private with_temp_index<T>(work: (index_file: string) => T): T {
    const folder = mkdtempSync(join(tmpdir(), "index-"));
    try {
      return work(join(folder, "index"));
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  }

  /** Paths of files git knows about or could add: tracked, plus untracked and not ignored. Nested repositories end in "/". */
  private known_paths(): string[] {
    return this.git(["ls-files", "-z", "--cached", "--others", "--exclude-standard"])
      .split("\0")
      .filter((p) => p !== "");
  }

  private in_data_dir(path: string): boolean {
    return path === brand.dataDir || path.startsWith(`${brand.dataDir}/`);
  }

  /**
   * Tree of everything in the folder now: tracked files (even ignored ones), modified files and untracked
   * files that are not ignored. The data folder and nested repositories are left out.
   */
  private current_tree(): string {
    const paths = this.known_paths().filter((path) => {
      if (path.endsWith("/") || this.in_data_dir(path)) return false;
      try {
        const kind = lstatSync(join(this.dir, path));
        return kind.isFile() || kind.isSymbolicLink();
      } catch {
        return false; // tracked file that was deleted
      }
    });
    return this.with_temp_index((index_file) => {
      const env = { GIT_INDEX_FILE: index_file };
      if (paths.length > 0) this.git(["update-index", "--add", "-z", "--stdin"], env, paths.join("\0") + "\0");
      return this.git(["write-tree"], env).trim();
    });
  }

  private next_ref(): string {
    const names = this.git(["for-each-ref", "--format=%(refname)", brand.refPrefix]).split("\n");
    let biggest = 0;
    for (const name of names) {
      const n = Number(name.slice(brand.refPrefix.length));
      if (Number.isInteger(n) && n > biggest) biggest = n;
    }
    return `${brand.refPrefix}${biggest + 1}`;
  }

  snapshot(label: string): string {
    const tree = this.current_tree();
    const id = this.git(["commit-tree", tree, "-m", label]).trim();
    this.git(["update-ref", this.next_ref(), id]);
    return id;
  }

  restore(id: string): void {
    const tree = this.git(["rev-parse", `${id}^{tree}`]).trim();
    const wanted = new Set(this.git(["ls-tree", "-r", "-z", "--name-only", tree]).split("\0").filter((p) => p !== ""));

    // Delete first, so a file that became a folder (or the reverse) cannot get in the way of the write.
    // Tracked or untracked files that are not in the checkpoint go. Ignored files stay, even tracked ones.
    const ignored_but_tracked = new Set(
      this.git(["ls-files", "-z", "--cached", "--ignored", "--exclude-standard"]).split("\0"),
    );
    const to_delete = this.known_paths().filter(
      (p) => !p.endsWith("/") && !wanted.has(p) && !this.in_data_dir(p) && !ignored_but_tracked.has(p),
    );
    for (const path of to_delete) {
      const full = join(this.dir, path);
      try {
        if (lstatSync(full).isDirectory()) continue;
        rmSync(full, { force: true });
      } catch (e) {
        const code = (e as { code?: string }).code;
        if (code !== "ENOENT" && code !== "ENOTDIR") throw e;
        continue;
      }
      this.remove_empty_parents(dirname(full));
    }

    // Write the checkpoint files over the folder, using a temporary index.
    this.with_temp_index((index_file) => {
      const env = { GIT_INDEX_FILE: index_file };
      this.git(["read-tree", tree], env);
      this.git(["checkout-index", "-a", "-f"], env);
    });

    // Staged changes are not kept: the real index goes back to HEAD.
    if (this.has_head()) this.git(["reset", "-q"]);
    else this.git(["read-tree", "--empty"]);
  }

  private has_head(): boolean {
    try {
      execFileSync("git", ["rev-parse", "--verify", "-q", "HEAD"], { cwd: this.dir, stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  }

  private remove_empty_parents(folder: string): void {
    let now = folder;
    while (now.startsWith(this.dir + "/") && existsSync(now) && readdirSync(now).length === 0) {
      rmdirSync(now);
      now = dirname(now);
    }
  }

  changedFiles(from_id: string, to_id: string): string[] {
    return this.git(["diff-tree", "-r", "--name-only", "-z", from_id, to_id])
      .split("\0")
      .filter((p) => p !== "");
  }

  hasChangedSince(id: string): boolean {
    const saved = this.git(["rev-parse", `${id}^{tree}`]).trim();
    return this.current_tree() !== saved;
  }
}
