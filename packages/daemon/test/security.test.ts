import { test, after } from "node:test";
import assert from "node:assert/strict";
import { brand, paths } from "@app/shared";
import { make_repo, ORIGIN, remove, start_daemon } from "./daemon_setup.ts";

const folders: string[] = [];
after(() => {
  for (const f of folders) remove(f);
});

async function with_daemon(fn: (d: Awaited<ReturnType<typeof start_daemon>>) => Promise<void>) {
  const dir = make_repo();
  folders.push(dir);
  const d = await start_daemon(dir);
  try {
    await fn(d);
  } finally {
    await d.close();
  }
}

// fetch cannot set Host, so these use a raw http request.
import { request } from "node:http";
function raw(port: number, path: string, headers: Record<string, string>, method = "GET"): Promise<{ status: number; headers: Record<string, any>; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path, method, headers }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

test("wrong Host is 403 (DNS rebinding)", () =>
  with_daemon(async (d) => {
    const r = await raw(d.port, paths.threads, { host: "evil.example.com", [brand.tokenHeader]: d.token });
    assert.equal(r.status, 403);
    assert.equal(JSON.parse(r.body).error, "forbidden_host");
    const wrong_port = await raw(d.port, paths.health, { host: `127.0.0.1:${d.port + 1}` });
    assert.equal(wrong_port.status, 403);
  }));

test("foreign Origin is 403 and has no CORS header", () =>
  with_daemon(async (d) => {
    const r = await d.call("GET", paths.threads, undefined, { origin: "http://evil.example.com" });
    assert.equal(r.status, 403);
    assert.equal((await r.json()).error, "forbidden_origin");
    assert.equal(r.headers.get("access-control-allow-origin"), null);
  }));

test("allowed Origin gets CORS headers and preflight succeeds without a token", () =>
  with_daemon(async (d) => {
    const ok = await d.call("GET", paths.threads, undefined, { origin: ORIGIN });
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get("access-control-allow-origin"), ORIGIN);
    const pre = await fetch(d.url + paths.threads, {
      method: "OPTIONS",
      headers: { origin: ORIGIN, "access-control-request-method": "POST", "access-control-request-headers": `content-type, ${brand.tokenHeader}` },
    });
    assert.ok(pre.status === 200 || pre.status === 204, `preflight status ${pre.status}`);
    assert.equal(pre.headers.get("access-control-allow-origin"), ORIGIN);
    assert.ok((pre.headers.get("access-control-allow-headers") ?? "").toLowerCase().includes(brand.tokenHeader));
    const bad = await fetch(d.url + paths.threads, { method: "OPTIONS", headers: { origin: "http://evil.example.com" } });
    assert.equal(bad.status, 403);
  }));

test("missing token is 401 on POST, allowed on GET /health", () =>
  with_daemon(async (d) => {
    const r = await fetch(d.url + paths.threads, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    assert.equal(r.status, 401);
    assert.equal((await r.json()).error, "unauthorized");
    assert.equal((await fetch(d.url + paths.health)).status, 200);
  }));

test("a wrong token is 401", () =>
  with_daemon(async (d) => {
    const r = await d.call("GET", paths.threads, undefined, { [brand.tokenHeader]: "nope" });
    assert.equal(r.status, 401);
  }));

test("localhost Host with the right port is accepted", () =>
  with_daemon(async (d) => {
    const r = await raw(d.port, paths.threads, { host: `localhost:${d.port}`, [brand.tokenHeader]: d.token });
    assert.equal(r.status, 200);
  }));
