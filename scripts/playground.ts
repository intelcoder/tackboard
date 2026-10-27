import { execFileSync, spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { appendFileSync, chmodSync, cpSync, existsSync, lstatSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync } from "node:fs";
import { createServer as createWebServer } from "node:http";
import type { Server } from "node:http";
import { createServer as createNetServer } from "node:net";
import type { Server as NetServer } from "node:net";
import { tmpdir } from "node:os";
import { createInterface } from "node:readline";
import { extname, join, resolve, sep } from "node:path";
import { brand } from "../packages/shared/src/brand.ts";

const root = join(import.meta.dirname, "..");
const cli = join(root, "packages", "cli", "src", "main.ts");

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css",
  ".js": "text/javascript",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

/** A small web server for one folder. HTML pages get `scriptTag` added before </head>. */
export function createSiteServer(folder: string, scriptTag: string): Server {
  const base = resolve(folder);
  const realBase = realpathSync(base);
  return createWebServer((req, res) => {
    const refuse = (status: number, message: string, headers: Record<string, string> = {}) =>
      res.writeHead(status, { "content-type": "text/plain", ...headers }).end(message);
    if (req.method !== "GET" && req.method !== "HEAD") return refuse(405, "only GET and HEAD are allowed", { allow: "GET, HEAD" });
    // Only this machine's own names are accepted, so a web page on another site cannot read these pages.
    const port = req.socket.localPort;
    if (req.headers.host !== `localhost:${port}` && req.headers.host !== `127.0.0.1:${port}`) return refuse(421, "wrong host name");
    const notFound = () => refuse(404, "not found");
    // The address is used as written, so "//" is never read as a host name.
    const pathAsWritten = (req.url ?? "/").split(/[?#]/)[0]!;
    let path: string;
    try {
      path = decodeURIComponent(pathAsWritten);
    } catch {
      return notFound();
    }
    if (path.includes("\0")) return notFound();
    // Files and folders that start with a dot (.git, .claude and the data folder) are never served. ".." is stopped below.
    if (path.split("/").some((part) => part.startsWith(".") && part !== "..")) return notFound();
    const file = resolve(base, `.${path === "/" ? "/index.html" : path}`);
    if (!file.startsWith(base + sep)) return notFound();
    // A link inside the folder that points outside it must not be followed.
    let real: string;
    try {
      real = realpathSync(file);
    } catch {
      return notFound();
    }
    if (!real.startsWith(realBase + sep) || !statSync(real).isFile()) return notFound();
    // The real file decides the type, so a link or a different spelling of the name cannot change it.
    const extension = extname(real).toLowerCase();
    const type = CONTENT_TYPES[extension] ?? "application/octet-stream";
    const body = extension === ".html" ? readFileSync(real, "utf8").replace("</head>", `${scriptTag}</head>`) : readFileSync(real);
    res.writeHead(200, { "content-type": type, "cache-control": "no-store" }).end(req.method === "HEAD" ? undefined : body);
  });
}

/** Reserves the first port if it is free, otherwise any free port. The caller closes it just before using the port. */
function reservePort(first: number): Promise<NetServer> {
  return new Promise((done, fail) => {
    const reserved = createNetServer();
    reserved.once("error", () => (first === 0 ? fail(new Error("no free port")) : reservePort(0).then(done, fail)));
    reserved.listen(first, "127.0.0.1", () => done(reserved));
  });
}

/** Why reset must not touch `folder`, or null when it is the copy this run made. */
export function reasonNotToReset(folder: string, copyFolder: string, repoFolder: string): string | null {
  let real: string;
  try {
    real = realpathSync(folder);
  } catch {
    return `${folder} is not there`;
  }
  if (lstatSync(folder).isSymbolicLink()) return `${folder} is a link, not a folder`;
  if (real !== copyFolder) return `${real} is not the folder this run made`;
  if (real === repoFolder) return `${real} is this repo`;
  if (real.startsWith(repoFolder + sep)) return `${real} is inside this repo`;
  if (repoFolder.startsWith(real + sep)) return `${real} holds this repo`;
  if (!real.startsWith(realpathSync(tmpdir()) + sep)) return `${real} is not inside the temp folder`;
  try {
    const top = execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: real, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    if (realpathSync(top) === real) return null;
  } catch {
    // no git project here
  }
  return `${real} is not its own git project`;
}

/** Makes every folder below `folder` writable (links are not followed), so a read-only folder can still be removed. The git data is skipped. */
function makeFoldersWritable(folder: string): void {
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === ".git") continue;
    const path = join(folder, entry.name);
    chmodSync(path, 0o755);
    makeFoldersWritable(path);
  }
}

function run(command: string, args: string[], cwd: string): void {
  execFileSync(command, args, { cwd, stdio: "inherit" });
}

async function main(): Promise<void> {
  // Ctrl+C, a closed terminal and a kill all stop the daemon and the site. This comes first, so nothing is started before it is ready.
  let folder = "";
  let daemon: ChildProcess | undefined;
  let server: Server | undefined;
  let leaving = false;
  let resetting = false;
  // The daemon gets its own process group, so one signal reaches the CLI and the daemon it starts.
  const signalDaemon = (signal: NodeJS.Signals) => {
    try {
      process.kill(-daemon!.pid!, signal);
    } catch {
      // already gone
    }
  };
  const daemonIsStopped = () => daemon!.exitCode !== null || daemon!.signalCode !== null;
  const stopDaemon = async (): Promise<void> => {
    if (!daemon) return;
    const stopped = new Promise((done) => (daemonIsStopped() ? done(null) : daemon!.once("exit", done)));
    signalDaemon("SIGTERM");
    await Promise.race([stopped, new Promise((done) => setTimeout(done, 3000))]);
    signalDaemon("SIGKILL");
    await stopped;
  };
  const leave = async () => {
    if (leaving) return;
    leaving = true;
    await stopDaemon();
    server?.close();
    server?.closeAllConnections();
    if (folder) console.log(`Stopped. The folder is still at ${folder}`);
    process.exit(0);
  };
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.on(signal, () => void leave());

  if (!existsSync(join(root, "packages", "overlay", "dist", brand.bundle))) run("npm", ["run", "build"], root);

  // A new folder every time. Old folders are never reused or deleted by a new run (only a reset clears the folder it made).
  folder = realpathSync(mkdtempSync(join(tmpdir(), `${brand.cli}-playground-`)));
  // Only the site folder is served. The copy's own root keeps the git data, the daemon token and the agent skill.
  cpSync(join(root, "playground", "site"), join(folder, "site"), { recursive: true });
  run("git", ["init", "-q", "-b", "main"], folder);
  run("git", ["config", "user.name", "Playground"], folder);
  run("git", ["config", "user.email", "playground@example.com"], folder);
  run("git", ["add", "-A"], folder);
  run("git", ["commit", "-q", "-m", "first pages"], folder);
  const firstCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: folder, encoding: "utf8" }).trim();
  const git = (...args: string[]) => execFileSync("git", args, { cwd: folder, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });

  const reservedPort = await reservePort(5199);
  const sitePort = (reservedPort.address() as { port: number }).port;
  const site = `http://localhost:${sitePort}`;
  run("node", [cli, "init", "--origin", site], folder);
  // The installed skill stays through a reset, so git is told to ignore it and a reset leaves a clean status.
  appendFileSync(join(folder, ".git", "info", "exclude"), ".claude/\n");

  const startDaemon = async (): Promise<string> => {
    const child = spawn("node", [cli, "start"], { cwd: folder, stdio: ["ignore", "pipe", "inherit"], detached: true });
    daemon = child;
    child.once("exit", () => {
      if (daemon === child && !leaving && !resetting) console.log("The comments daemon stopped. Type reset to start it again.");
    });
    return new Promise<string>((done, fail) => {
      let seen = "";
      child.once("exit", () => !leaving && fail(new Error(`the daemon stopped early: ${seen}`)));
      child.stdout!.on("data", (chunk) => {
        seen += chunk;
        const found = /listening 127\.0\.0\.1:(\d+)/.exec(seen);
        if (found) done(found[1]!);
      });
    });
  };
  const daemonPort = await startDaemon();

  server = createSiteServer(join(folder, "site"), `<script src="http://127.0.0.1:${daemonPort}/${brand.bundle}"></script>`);
  await new Promise<void>((done) => reservedPort.close(() => done()));
  await new Promise<void>((done) => server.listen(sitePort, "127.0.0.1", () => done()));

  const reset = async (): Promise<void> => {
    if (resetting) return console.log("A reset is already running. Wait for it to finish.");
    const reason = reasonNotToReset(folder, folder, realpathSync(root));
    if (reason) return console.log(`Reset not done: ${reason}. Nothing was changed.`);
    resetting = true;
    try {
      console.log("Resetting...");
      await stopDaemon();
      // A read-only folder, tracked or not, would stop the abort, the checkout and the clean, so this comes first.
      makeFoldersWritable(folder);
      // A half-finished git job would stop the checkout, so clear it first.
      for (const name of readdirSync(join(folder, ".git"), { recursive: true })) {
        if (String(name).endsWith(".lock")) rmSync(join(folder, ".git", String(name)), { force: true });
      }
      for (const job of ["merge", "rebase", "cherry-pick", "revert", "am"]) {
        try {
          git(job, "--abort");
        } catch {
          // not in progress
        }
      }
      git("checkout", "-q", "-f", "-B", "main", firstCommit);
      // Every other branch, tag, stash and snapshot is a reference.
      for (const name of git("for-each-ref", "--format=%(refname)").split("\n")) {
        if (name !== "" && name !== "refs/heads/main") git("update-ref", "-d", name);
      }
      git("clean", "-q", "-f", "-f", "-d", "-x", "-e", brand.dataDir, "-e", ".claude");
      const dataFolder = join(folder, brand.dataDir);
      for (const name of readdirSync(dataFolder)) {
        if (name.startsWith(brand.dbFile)) rmSync(join(dataFolder, name), { force: true });
      }
      if (!leaving) await startDaemon();
      console.log("Reset finished: files are back to the first version, comments cleared.");
    } catch (error) {
      // The open pages must keep working, so the daemon comes back, before the message, even when the reset did not finish.
      if (daemonIsStopped() && !leaving) await startDaemon().catch(() => console.log("The comments daemon could not start again."));
      console.log(`Reset failed: ${error instanceof Error ? error.message : String(error)}. Type reset to try again.`);
    } finally {
      resetting = false;
    }
  };
  createInterface({ input: process.stdin }).on("line", (line) => {
    if (["reset", "r"].includes(line.trim().toLowerCase())) void reset();
    else console.log('Type "reset" (or "r") and press Enter to start over.');
  });

  console.log(`Playground site: ${site}`);
  console.log(`Project folder: ${folder}`);
  console.log(`Pages: ${join(folder, "site")}`);
  console.log(`Start an agent there: cd "${folder}" && claude`);
  console.log(`Comments daemon: http://127.0.0.1:${daemonPort}`);
  console.log("To start over, type reset and press Enter: files go back to the first version and comments are cleared.");
  console.log("Press Ctrl+C to stop. The folder stays where it is.");
}

if (import.meta.main) await main();
