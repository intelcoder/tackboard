import { execFileSync, spawn } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, realpathSync, statSync } from "node:fs";
import { createServer as createWebServer } from "node:http";
import type { Server } from "node:http";
import { createServer as createNetServer } from "node:net";
import type { Server as NetServer } from "node:net";
import { tmpdir } from "node:os";
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

function run(command: string, args: string[], cwd: string): void {
  execFileSync(command, args, { cwd, stdio: "inherit" });
}

async function main(): Promise<void> {
  if (!existsSync(join(root, "packages", "overlay", "dist", brand.bundle))) run("npm", ["run", "build"], root);

  // A new folder every time. Nothing is ever deleted.
  const folder = mkdtempSync(join(tmpdir(), `${brand.cli}-playground-`));
  // Only the site folder is served. The copy's own root keeps the git data, the daemon token and the agent skill.
  cpSync(join(root, "playground", "site"), join(folder, "site"), { recursive: true });
  run("git", ["init", "-q", "-b", "main"], folder);
  run("git", ["config", "user.name", "Playground"], folder);
  run("git", ["config", "user.email", "playground@example.com"], folder);
  run("git", ["add", "-A"], folder);
  run("git", ["commit", "-q", "-m", "first pages"], folder);

  const reservedPort = await reservePort(5199);
  const sitePort = (reservedPort.address() as { port: number }).port;
  const site = `http://localhost:${sitePort}`;
  run("node", [cli, "init", "--origin", site], folder);

  const daemon = spawn("node", [cli, "start"], { cwd: folder, stdio: ["ignore", "pipe", "inherit"] });
  const daemonPort = await new Promise<string>((done, fail) => {
    let seen = "";
    daemon.once("exit", () => fail(new Error(`the daemon stopped early: ${seen}`)));
    daemon.stdout.on("data", (chunk) => {
      seen += chunk;
      const found = /listening 127\.0\.0\.1:(\d+)/.exec(seen);
      if (found) done(found[1]!);
    });
  });

  const server = createSiteServer(join(folder, "site"), `<script src="http://127.0.0.1:${daemonPort}/${brand.bundle}"></script>`);
  await new Promise<void>((done) => reservedPort.close(() => done()));
  await new Promise<void>((done) => server.listen(sitePort, "127.0.0.1", () => done()));

  console.log(`Playground site: ${site}`);
  console.log(`Project folder: ${folder}`);
  console.log(`Pages: ${join(folder, "site")}`);
  console.log(`Start an agent there: cd "${folder}" && claude`);
  console.log(`Comments daemon: http://127.0.0.1:${daemonPort}`);
  console.log("Press Ctrl+C to stop. The folder stays where it is.");

  for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => daemon.kill("SIGTERM"));
  daemon.once("exit", () => {
    server.close();
    server.closeAllConnections();
    console.log(`Stopped. The folder is still at ${folder}`);
    process.exit(0);
  });
}

if (import.meta.main) await main();
