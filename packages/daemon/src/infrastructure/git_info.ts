import { execFileSync } from "node:child_process";
import { Branch, CommitSha } from "../domain/value_objects.ts";
import type { GitInfo } from "../domain/repositories.ts";

/** Reads the branch and commit from git. Outside a repository the branch is "no-git". */
export class GitInfoReader implements GitInfo {
  private dir: string;
  constructor(dir: string) {
    this.dir = dir;
  }

  private ask(...args: string[]): string | null {
    try {
      return execFileSync("git", args, { cwd: this.dir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    } catch {
      return null;
    }
  }

  branch(): Branch {
    if (this.ask("rev-parse", "--git-dir") === null) return Branch.of("no-git");
    const name = this.ask("symbolic-ref", "--short", "-q", "HEAD");
    return Branch.of(name === null || name === "" ? "HEAD" : name);
  }

  commit(): CommitSha {
    const sha = this.ask("rev-parse", "--short", "HEAD");
    return CommitSha.of(sha !== null && /^[0-9a-f]{7,40}$/.test(sha) ? sha : "0000000");
  }

  branches(): string[] {
    const out = this.ask("for-each-ref", "--format=%(refname:short)", "refs/heads/");
    return out ? out.split("\n").filter((n) => n !== "") : [];
  }
}
