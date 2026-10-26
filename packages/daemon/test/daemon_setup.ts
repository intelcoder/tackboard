import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { brand } from "@app/shared";
import { createDaemon } from "../src/index.ts";

const git_env = {
  ...process.env,
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@example.com",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@example.com",
};

export function git(dir: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: dir, env: git_env, encoding: "utf8" });
}

export function make_repo(): string {
  const dir = mkdtempSync(join(tmpdir(), "daemon-"));
  git(dir, "init", "-q", "-b", "main");
  writeFileSync(join(dir, ".gitignore"), `${brand.dataDir}/\n`);
  writeFileSync(join(dir, "a.txt"), "a1\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "first");
  return dir;
}

export function make_plain_folder(): string {
  return mkdtempSync(join(tmpdir(), "daemon-nogit-"));
}

export const ORIGIN = "http://localhost:3000";

export type Running = {
  dir: string;
  url: string;
  port: number;
  token: string;
  close(): Promise<void>;
  daemon: ReturnType<typeof createDaemon>;
  call(method: string, path: string, body?: unknown, headers?: Record<string, string>): Promise<Response>;
};

export async function start_daemon(
  dir: string,
  extra: { bundlePath?: string; token?: string } = {},
): Promise<Running> {
  const token = extra.token ?? "test-token";
  mkdirSync(join(dir, brand.dataDir), { recursive: true });
  const daemon = createDaemon({
    projectDir: dir,
    port: 0,
    allowedOrigins: [ORIGIN],
    token,
    bundlePath: extra.bundlePath,
  });
  const port = await daemon.listen();
  const url = `http://127.0.0.1:${port}`;
  return {
    dir,
    url,
    port,
    token,
    daemon,
    close: () => daemon.close(),
    call: (method, path, body, headers = {}) =>
      fetch(url + path, {
        method,
        headers: { "content-type": "application/json", [brand.tokenHeader]: token, ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
  };
}

export function remove(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}
