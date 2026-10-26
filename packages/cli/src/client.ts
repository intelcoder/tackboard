import { execFileSync } from "node:child_process";
import { brand, findConfig, paths } from "@app/shared";
import type { ApiErrorBody, ProjectConfig } from "@app/shared";

export class CliError extends Error {}

export type Client = {
  dir: string;
  config: ProjectConfig;
  agent: string;
  get<T>(path: string, query?: Record<string, string>): Promise<T>;
  post<T>(path: string, body?: unknown): Promise<T>;
};

export function currentBranch(cwd: string): string | undefined {
  try {
    const b = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return b || undefined;
  } catch {
    return undefined;
  }
}

export function connect(cwd: string, agentFlag?: string): Client {
  const found = findConfig(cwd);
  if (!found) throw new CliError(`no ${brand.cli} project found here; run ${brand.cli} init`);
  const { dir, config } = found;
  const agent = agentFlag ?? process.env[`${brand.envPrefix}AGENT`] ?? "claude-main";
  const base = `http://127.0.0.1:${config.port}`;

  async function call<T>(method: string, path: string, query?: Record<string, string>, body?: unknown): Promise<T> {
    const url = new URL(path, base);
    for (const [k, v] of Object.entries(query ?? {})) url.searchParams.set(k, v);
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: { [brand.tokenHeader]: config.token, "content-type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch {
      throw new CliError(`cannot reach the daemon on port ${config.port}; run ${brand.cli} start`);
    }
    const data = (await res.json()) as unknown;
    if (!res.ok) throw new CliError((data as ApiErrorBody).message ?? `request failed (${res.status})`);
    return data as T;
  }

  return {
    dir,
    config,
    agent,
    get: (path, query) => call("GET", path, query),
    post: (path, body) => call("POST", path, undefined, body ?? {}),
  };
}

export { paths };
