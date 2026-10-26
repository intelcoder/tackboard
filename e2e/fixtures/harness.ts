import { spawn, execFileSync } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer as createWebServer } from "node:http";
import type { Server } from "node:http";
import { createServer as createPortProbe } from "node:net";
import { tmpdir } from "node:os";
import { extname, join, normalize } from "node:path";
import { chromium, expect, test as base } from "@playwright/test";
import type { Browser, Page } from "@playwright/test";
import { brand } from "../../packages/shared/src/brand.ts";
import { buildReactSite } from "./react-site/build.ts";

const root = join(import.meta.dirname, "..", "..");
const cli = join(root, "packages", "cli", "src", "main.ts");

export type Harness = {
  page: Page;
  repo: string;
  siteUrl: string;
  daemonUrl: string;
  /** Console errors, page errors and failed requests seen so far. Specs expect this to stay empty. */
  problems: string[];
  agent(args: string[], env?: Record<string, string>): Promise<{ stdout: string; code: number }>;
  git(args: string[]): string;
  restartDaemon(env?: Record<string, string>): Promise<void>;
  stopAll(): Promise<void>;
};

export type HarnessOptions = { site?: "plain" | "react" | "react-plugin"; env?: Record<string, string> };

function freePort(): Promise<number> {
  return new Promise((done, fail) => {
    const probe = createPortProbe();
    probe.once("error", fail);
    probe.listen(0, "127.0.0.1", () => {
      const port = (probe.address() as { port: number }).port;
      probe.close(() => done(port));
    });
  });
}

const TYPES: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };

function serveFolder(folder: string, port: number): Promise<Server> {
  const server = createWebServer((req, res) => {
    const asked = normalize(decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname)).replace(/^(\.\.[/\\])+/, "");
    const name = asked === "/" ? "/index.html" : asked;
    try {
      const body = readFileSync(join(folder, name));
      res.writeHead(200, { "content-type": TYPES[extname(name)] ?? "application/octet-stream", "cache-control": "no-store" });
      res.end(body);
    } catch {
      res.writeHead(404).end("not found");
    }
  });
  return new Promise((done) => server.listen(port, "127.0.0.1", () => done(server)));
}

function run(args: string[], cwd: string, env: Record<string, string> = {}): Promise<{ stdout: string; code: number }> {
  return new Promise((done) => {
    const child = spawn("node", [cli, ...args], { cwd, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "ignore"] });
    let stdout = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.on("close", (code) => done({ stdout, code: code ?? 1 }));
  });
}

export async function startHarness(opts: HarnessOptions = {}): Promise<Harness> {
  const site = opts.site ?? "plain";
  const repo = mkdtempSync(join(tmpdir(), "tb-e2e-"));
  const sitePort = await freePort();
  let daemonPort = await freePort();
  while (daemonPort === sitePort) daemonPort = await freePort();
  const siteUrl = `http://127.0.0.1:${sitePort}`;
  const daemonUrl = `http://127.0.0.1:${daemonPort}`;

  const git = (args: string[]) => execFileSync("git", args, { cwd: repo, encoding: "utf8" });
  git(["init", "-q", "-b", "main"]);
  git(["config", "user.email", "e2e@example.com"]);
  git(["config", "user.name", "e2e"]);

  const init = await run(["init", "--origin", siteUrl, "--port", String(daemonPort), "--user", "sam"], repo);
  if (init.code !== 0) throw new Error(`init failed: ${init.stdout}`);

  const page_file = site === "plain" ? join("site", "index.html") : join("react-site", "index.html");
  const page_html = readFileSync(join(import.meta.dirname, page_file), "utf8").replace("{{BUNDLE_URL}}", `${daemonUrl}/${brand.bundle}`);
  writeFileSync(join(repo, "index.html"), page_html);
  if (site !== "plain") await buildReactSite(repo, site === "react-plugin");
  git(["add", "-A"]);
  git(["commit", "-q", "-m", "first page"]);

  let daemon: ChildProcess | null = null;
  const startDaemon = (env: Record<string, string> = {}): Promise<void> =>
    new Promise((done, fail) => {
      const child = spawn("node", [cli, "start"], {
        cwd: repo,
        env: { ...process.env, NODE_ENV: "test", ...opts.env, ...env },
        stdio: ["ignore", "pipe", "ignore"],
      });
      daemon = child;
      let seen = "";
      const timer = setTimeout(() => fail(new Error(`daemon did not start: ${seen}`)), 15000);
      child.stdout!.on("data", (d) => {
        seen += d;
        if (seen.includes("listening")) {
          clearTimeout(timer);
          done();
        }
      });
      child.once("exit", () => {
        clearTimeout(timer);
        fail(new Error(`daemon exited early: ${seen}`));
      });
    });
  const stopDaemon = async (): Promise<void> => {
    const child = daemon as ChildProcess | null;
    daemon = null;
    if (!child || child.exitCode !== null) return;
    const gone = new Promise<void>((done) => child.once("exit", () => done()));
    child.kill("SIGTERM");
    await gone;
  };

  await startDaemon();
  const server = await serveFolder(repo, sitePort);
  const browser: Browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const problems: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") problems.push(`console: ${m.text()}`);
  });
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  page.on("requestfailed", (r) => problems.push(`request failed: ${r.url()} ${r.failure()?.errorText}`));
  page.on("response", (r) => {
    if (r.status() >= 400) problems.push(`response ${r.status()}: ${r.url()}`);
  });
  await page.goto(siteUrl);
  await page.locator(`#${brand.hostId}`).waitFor({ state: "attached" });

  return {
    page,
    repo,
    siteUrl,
    daemonUrl,
    problems,
    agent: (args, env) => run(args, repo, env),
    git,
    async restartDaemon(env) {
      await stopDaemon();
      await startDaemon(env);
    },
    async stopAll() {
      await browser.close();
      await new Promise<void>((done) => server.close(() => done()));
      await stopDaemon();
      rmSync(repo, { recursive: true, force: true });
    },
  };
}

/** A Playwright test whose `harness` starts and stops the whole stack, and fails on browser problems. */
export const test = base.extend<{ harness: Harness; site: NonNullable<HarnessOptions["site"]> }>({
  site: ["plain", { option: true }],
  harness: async ({ site }, use) => {
    const harness = await startHarness({ site });
    try {
      await use(harness);
      expect(harness.problems, "console errors and failed requests").toEqual([]);
    } finally {
      await harness.stopAll();
    }
  },
});

export { expect };
