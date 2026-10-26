import type { Context, MiddlewareHandler } from "hono";
import { brand, ERROR_STATUS, LIMITS } from "@app/shared";
import type { ErrorCode } from "@app/shared";
import { DomainError } from "../domain/errors.ts";

export type SecurityOptions = {
  allowedOrigins: string[];
  token: string;
  /** The port the daemon is really listening on (it may be chosen by the system). */
  port(): number;
};

/** Paths that need no token. */
const open_paths = new Set(["/health", `/${brand.bundle}`]);

function refuse(c: Context, code: ErrorCode, message: string): Response {
  return c.json({ error: code, message }, ERROR_STATUS[code] as 400);
}

/** Reads the whole body, but stops keeping bytes once it is over the limit, so a huge upload cannot fill memory. */
async function read_body(request: Request): Promise<string> {
  if (!request.body) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = request.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size <= LIMITS.body) chunks.push(value);
  }
  if (size > LIMITS.body) throw new DomainError("too_large", "request body is larger than 2 MB");
  return Buffer.concat(chunks).toString("utf8");
}

/** Host check, Origin check, token check, CORS headers, then the body and text limits. In that order. */
export function security(opts: SecurityOptions): MiddlewareHandler {
  return async (c, next) => {
    const host = c.req.header("host") ?? "";
    const port = opts.port();
    if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) {
      return refuse(c, "forbidden_host", "this address is not allowed");
    }

    const origin = c.req.header("origin");
    if (origin !== undefined) {
      if (!opts.allowedOrigins.includes(origin)) return refuse(c, "forbidden_origin", "this origin is not allowed");
      c.header("access-control-allow-origin", origin);
      c.header("vary", "Origin");
    }

    if (c.req.method === "OPTIONS") {
      c.header("access-control-allow-methods", "GET, POST, OPTIONS");
      c.header("access-control-allow-headers", `content-type, ${brand.tokenHeader}`);
      c.header("access-control-max-age", "600");
      return c.body(null, 204);
    }

    if (!open_paths.has(c.req.path) && c.req.header(brand.tokenHeader) !== opts.token) {
      return refuse(c, "unauthorized", "missing or wrong token");
    }

    if (c.req.method === "POST") {
      const raw = await read_body(c.req.raw);
      let body: unknown = {};
      if (raw !== "") {
        try {
          body = JSON.parse(raw);
        } catch {
          throw new DomainError("invalid", "body is not valid JSON");
        }
      }
      if (typeof body !== "object" || body === null || Array.isArray(body)) {
        throw new DomainError("invalid", "body must be a JSON object");
      }
      const text = (body as { text?: unknown }).text;
      if (typeof text === "string" && text.length > LIMITS.text) {
        throw new DomainError("too_large", "text is longer than 100 KB");
      }
      c.set("body", body);
    }
    await next();
  };
}
