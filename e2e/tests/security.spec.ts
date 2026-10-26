import { request } from "node:http";
import type { IncomingHttpHeaders } from "node:http";
import { createServer } from "node:http";
import { createServer as createPortProbe } from "node:net";
import { brand } from "../../packages/shared/src/brand.ts";
import { test, expect } from "../fixtures/harness.ts";

type Reply = { status: number; headers: IncomingHttpHeaders; body: string };

/** A raw request, so the test can choose the Host and Origin headers itself. */
function raw(url: string, path: string, headers: Record<string, string>, method = "GET"): Promise<Reply> {
  const target = new URL(url);
  return new Promise((done, fail) => {
    const req = request({ host: target.hostname, port: target.port, path, method, headers }, (res) => {
      let body = "";
      res.on("data", (d) => (body += d));
      res.on("end", () => done({ status: res.statusCode ?? 0, headers: res.headers, body }));
    });
    req.on("error", fail);
    req.end();
  });
}

const error_code = (reply: Reply) => (JSON.parse(reply.body) as { error: string }).error;

test("security", async ({ harness: h }) => {
  const token = await h.page.evaluate((name) => (globalThis as any)[name].token as string, brand.configGlobal);
  const allowed_origin = new URL(h.siteUrl).origin;
  const good = { [brand.tokenHeader]: token, origin: allowed_origin };
  const count_threads = async () =>
    ((await (await fetch(`${h.daemonUrl}/threads`, { headers: { [brand.tokenHeader]: token } })).json()) as { threads: unknown[] }).threads.length;

  // control: the right Host, an allowed Origin and the token work, and the allowed origin gets CORS headers
  const control = await raw(h.daemonUrl, "/threads", good);
  expect(control.status).toBe(200);
  expect(control.headers["access-control-allow-origin"]).toBe(allowed_origin);

  // a foreign Origin gets 403 and no CORS header, even with a valid token
  const foreign = await raw(h.daemonUrl, "/threads", { [brand.tokenHeader]: token, origin: "http://evil.example" });
  expect(foreign.status).toBe(403);
  expect(error_code(foreign)).toBe("forbidden_origin");
  expect(foreign.headers["access-control-allow-origin"]).toBeUndefined();
  const preflight = await raw(h.daemonUrl, "/threads", { origin: "http://evil.example", "access-control-request-method": "GET", "access-control-request-headers": brand.tokenHeader }, "OPTIONS");
  expect(preflight.status).toBe(403);
  expect(preflight.headers["access-control-allow-origin"]).toBeUndefined();

  // a forged Host gets 403
  const forged = await raw(h.daemonUrl, "/threads", { ...good, host: "evil.example" });
  expect(forged.status).toBe(403);
  expect(error_code(forged)).toBe("forbidden_host");

  // a missing token gets 401, and a wrong token too
  const none = await raw(h.daemonUrl, "/threads", { origin: allowed_origin });
  expect(none.status).toBe(401);
  expect(error_code(none)).toBe("unauthorized");
  const wrong = await raw(h.daemonUrl, "/threads", { origin: allowed_origin, [brand.tokenHeader]: "0".repeat(token.length) });
  expect(wrong.status).toBe(401);

  // a page on a foreign origin
  let other_port = 0;
  const probe = createPortProbe();
  await new Promise<void>((done) => probe.listen(0, "127.0.0.1", () => done()));
  other_port = (probe.address() as { port: number }).port;
  await new Promise<void>((done) => probe.close(() => done()));
  const foreign_site = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html" });
    res.end(`<!doctype html><title>foreign</title><body><p id="target">foreign page</p><script src="${h.daemonUrl}/${brand.bundle}"></script>`);
  });
  await new Promise<void>((done) => foreign_site.listen(other_port, "127.0.0.1", () => done()));
  const foreign_browser = await h.page.context().browser()!.newContext({ viewport: { width: 1280, height: 800 } });
  const other = await foreign_browser.newPage();
  try {
    await other.goto(`http://127.0.0.1:${other_port}/`);
    await other.waitForFunction((name) => Boolean((globalThis as any)[name]), brand.configGlobal);

    // the page can read the token (documented trade-off) ...
    const seen = await other.evaluate((name) => (globalThis as any)[name] as { base: string; token: string }, brand.configGlobal);
    expect(seen.token).toBe(token);

    // ... yet its API calls fail: the browser blocks the read because the daemon sends no CORS headers
    const read = await other.evaluate(
      async ({ base, token, header }) => {
        try {
          await fetch(`${base}/threads`, { headers: { [header]: token } });
          return "allowed";
        } catch {
          return "blocked";
        }
      },
      { base: seen.base, token: seen.token, header: brand.tokenHeader },
    );
    expect(read).toBe("blocked");

    // a no-cors POST is still sent, but the daemon rejects it, so no thread appears
    await other.evaluate(async ({ base, token }) => {
      await fetch(`${base}/threads`, {
        method: "POST",
        mode: "no-cors",
        headers: { "content-type": "text/plain" },
        body: JSON.stringify({ token, text: "sneaky", url: "http://x", viewport: { w: 1, h: 1 }, element: { selector: "body", tag: "body", text: "", html: "", rect: { x: 0, y: 0, w: 1, h: 1 }, confidence: "text" } }),
      });
    }, { base: seen.base, token: seen.token });
    await other.waitForTimeout(500);
    expect(await count_threads()).toBe(0);

    // the overlay the foreign page loaded cannot post a comment either: the comment waits in the queue
    await other.locator(".tb-modes [data-mode=comment]").click();
    await other.hover("#target");
    await other.click("#target");
    await other.locator('[data-key="composer"]').fill("from a foreign page");
    await other.locator('[data-key="send"]').click();
    await expect(other.locator(".tb-queue .tb-queued")).toContainText("Waiting to retry");
    expect(await count_threads()).toBe(0);
  } finally {
    await foreign_browser.close();
    await new Promise<void>((done) => foreign_site.close(() => done()));
  }
});
