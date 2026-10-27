import test from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";
import type { Server } from "node:http";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSiteServer } from "../../../scripts/playground.ts";

const TAG = '<script src="http://127.0.0.1:1234/bundle.js"></script>';

/** Sends the path exactly as given, so "/../" and "//" reach the server untouched. */
function get(server: Server, path: string, options: { method?: string; host?: string | null } = {}): Promise<{ status: number; type: string; body: string; allow: string }> {
  const port = (server.address() as { port: number }).port;
  return new Promise((done, fail) => {
    const req = request({ host: "127.0.0.1", port, path, method: options.method ?? "GET", setHost: options.host === undefined }, (res) => {
      let body = "";
      res.on("data", (d) => (body += d));
      res.on("end", () => done({ status: res.statusCode ?? 0, type: String(res.headers["content-type"] ?? ""), body, allow: String(res.headers.allow ?? "") }));
    });
    if (options.host) req.setHeader("host", options.host);
    req.on("error", fail);
    req.end();
  });
}

/** The same shape as a real copy: the copy's root holds the secrets, and only its site folder is served. */
const SECRETS = ["secret in the root", "secret token", "secret git", "secret claude", "secret in an outside folder", "secret dotfile"];

async function withSite(fn: (server: Server, folder: string) => Promise<void>) {
  const root = mkdtempSync(join(tmpdir(), "site-test-"));
  const files: Record<string, string> = {
    "secret.txt": SECRETS[0]!,
    ".tackboard/config.json": SECRETS[1]!,
    ".git/config": SECRETS[2]!,
    ".claude/x": SECRETS[3]!,
    "outside/secret.txt": SECRETS[4]!,
    "site/.dotfile": SECRETS[5]!,
    "site/.hidden/note.txt": SECRETS[5]!,
    "site/index.html": "<html><head><title>Home</title></head><body>home</body></html>",
    "site/playground.css": "body { margin: 0 } /* </head> */",
    "site/data.json": "{}",
    "site/code.js": "var a = '</head>';",
    "site/logo.svg": "<svg><text></head></text></svg>",
    "site/dot.png": "png",
    "site/real.html": "<html><head></head><body>real</body></html>",
  };
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(join(root, name, ".."), { recursive: true });
    writeFileSync(join(root, name), text);
  }
  const folder = join(root, "site");
  mkdirSync(join(folder, "empty"));
  const links: Record<string, string> = {
    "link-secret.txt": "../secret.txt",
    "link-config.json": "../.tackboard/config.json",
    "link-git": "../.git",
    "link-claude": "../.claude",
    "link-outside": "../outside",
    "link-root": "..",
    "loop-a": "loop-b",
    "loop-b": "loop-a",
    "broken": "nothing-here",
    "chain-1": "chain-2",
    "chain-2": "../secret.txt",
    "link-inside.css": "playground.css",
    PAGE: "real.html",
    "link.TXT": "real.html",
    "fake.html": "playground.css",
  };
  for (const [name, target] of Object.entries(links)) symlinkSync(target, join(folder, name));
  const server = createSiteServer(folder, TAG);
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", () => done()));
  try {
    await fn(server, folder);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
  }
}

const showsSecret = (body: string) => SECRETS.some((secret) => body.includes(secret));

test("the script tag is added once to an html page, before </head>", () =>
  withSite(async (server) => {
    const page = await get(server, "/index.html");
    assert.equal(page.status, 200);
    assert.equal(page.body.split(TAG).length - 1, 1);
    assert.ok(page.body.includes(`${TAG}</head>`));
    const home = await get(server, "/");
    assert.equal(home.body, page.body);
  }));

test("the script tag is added to nothing but html", () =>
  withSite(async (server) => {
    for (const name of ["playground.css", "data.json", "code.js", "logo.svg", "dot.png"]) {
      const file = await get(server, `/${name}`);
      assert.equal(file.status, 200, name);
      assert.ok(!file.body.includes("<script"), name);
    }
  }));

test("the real file decides the type and the tag, not the name that was asked for", () =>
  withSite(async (server) => {
    for (const path of ["/PAGE", "/link.TXT"]) {
      const got = await get(server, path);
      assert.equal(got.status, 200, path);
      assert.ok(got.type.startsWith("text/html"), path);
      assert.equal(got.body.split(TAG).length - 1, 1, path);
    }
    const fake = await get(server, "/fake.html");
    assert.equal(fake.status, 200);
    assert.ok(fake.type.startsWith("text/css"));
    assert.ok(!fake.body.includes("<script"));
    // On a disk that ignores case this finds index.html; on another disk it is not found. Either way it is never served as a bare download.
    const shouting = await get(server, "/INDEX.HTML");
    assert.ok(shouting.status === 404 || (shouting.type.startsWith("text/html") && shouting.body.split(TAG).length - 1 === 1), `${shouting.status} ${shouting.type}`);
  }));

test("content types are right for html, css, js, json, svg and png", () =>
  withSite(async (server) => {
    const want: Record<string, string> = {
      "/index.html": "text/html",
      "/playground.css": "text/css",
      "/code.js": "text/javascript",
      "/data.json": "application/json",
      "/logo.svg": "image/svg+xml",
      "/dot.png": "image/png",
    };
    for (const [path, type] of Object.entries(want)) assert.ok((await get(server, path)).type.startsWith(type), path);
  }));

test("a path that leaves the served folder gets 404 and never shows the secrets beside it", () =>
  withSite(async (server, folder) => {
    assert.equal((await get(server, "/index.html")).status, 200);
    const paths = [
      "/../secret.txt", "/%2e%2e/secret.txt", "/%2E%2E/secret.txt", "/..%2fsecret.txt", "/%2e%2e%2fsecret.txt", "/%252e%252e/secret.txt", "/..%252fsecret.txt",
      "/../.tackboard/config.json", "/%2e%2e/%2etackboard/config.json", "/%2e%2e%2f.tackboard/config.json", "/%2e%2e%2f%2etackboard%2fconfig.json", "/%252e%252e%252f.tackboard/config.json",
      "/../.git/config", "/%2e%2e/.git/config", "/../.claude/x", "/%2e%2e/.claude/x", "/../outside/secret.txt",
      "/index.html/../../secret.txt", "/a/../../secret.txt",
      "//etc/passwd", "/etc/passwd", `/${folder}`, `//${folder}/index.html`, "/index.html%00.png", "/%00",
    ];
    for (const path of paths) {
      const got = await get(server, path);
      assert.equal(got.status, 404, path);
      assert.ok(!showsSecret(got.body), path);
    }
  }));

test("a link inside the site that points outside it gets 404, a link to a file inside it still works", () =>
  withSite(async (server) => {
    const paths = [
      "/link-secret.txt", "/link-config.json", "/link-git/config", "/link-git/HEAD", "/link-claude/x", "/link-outside/secret.txt", "/link-root/secret.txt", "/link-root/.tackboard/config.json",
      "/chain-1", "/chain-2", "/loop-a", "/loop-b/x", "/broken", "/link-git", "/link-outside",
    ];
    for (const path of paths) {
      const got = await get(server, path);
      assert.equal(got.status, 404, path);
      assert.ok(!showsSecret(got.body), path);
    }
    const inside = await get(server, "/link-inside.css");
    assert.equal(inside.status, 200);
    assert.ok(inside.body.includes("margin"));
  }));

test("files and folders that start with a dot get 404, even when they exist inside the site", () =>
  withSite(async (server) => {
    const paths = ["/.dotfile", "/%2edotfile", "/%2Edotfile", "/.hidden/note.txt", "/%2ehidden/note.txt", "/.git/config", "/.tackboard/config.json", "/.claude/x", "/index.html/../.dotfile", "/a/.hidden/b"];
    for (const path of paths) {
      const got = await get(server, path);
      assert.equal(got.status, 404, path);
      assert.ok(!showsSecret(got.body), path);
    }
  }));

test("only GET and HEAD are served; other methods get 405", () =>
  withSite(async (server) => {
    assert.equal((await get(server, "/index.html", { method: "HEAD" })).status, 200);
    for (const method of ["POST", "PUT", "DELETE", "PATCH"]) {
      const got = await get(server, "/index.html", { method });
      assert.equal(got.status, 405, method);
      assert.equal(got.allow, "GET, HEAD", method);
    }
  }));

test("a wrong or missing Host header is refused", () =>
  withSite(async (server) => {
    const port = (server.address() as { port: number }).port;
    for (const host of [`localhost:${port}`, `127.0.0.1:${port}`]) assert.equal((await get(server, "/index.html", { host })).status, 200, host);
    for (const host of ["evil.example.com", `evil.example.com:${port}`, `localhost:${port + 1}`, "localhost", null]) {
      const got = await get(server, "/index.html", { host });
      assert.ok(got.status === 421 || got.status === 400, `${host}: ${got.status}`); // Node itself answers 400 when there is no Host at all
      assert.ok(!got.body.includes("home"), String(host));
    }
  }));

test("a missing file and a folder both get 404, and there is no listing", () =>
  withSite(async (server) => {
    assert.equal((await get(server, "/nothing.html")).status, 404);
    const folder = await get(server, "/empty/");
    assert.equal(folder.status, 404);
    assert.ok(!folder.body.includes("index.html"));
    assert.equal((await get(server, "/empty")).status, 404);
  }));
