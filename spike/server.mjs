// THROWAWAY SPIKE: not the real design. No auth, no DDD, flat JSON file.
import { createServer } from "node:http";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const dir = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 4777);
const DATA = process.env.DATA || join(dir, "data.json");
const db = existsSync(DATA) ? JSON.parse(readFileSync(DATA, "utf8")) : { threads: [] };
const save = () => writeFileSync(DATA, JSON.stringify(db, null, 2));
const branch = () => {
  try { return execSync("git rev-parse --abbrev-ref HEAD", { cwd: dir, stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); }
  catch { return "no-git"; } // ponytail: spike dir is not a git repo
};
const find = (id) => db.threads.find((t) => t.id === id);

const routes = {
  "GET /tackboard.js": () => ["js", readFileSync(join(dir, "overlay.js"), "utf8")],
  "GET /demo": () => ["html", readFileSync(join(dir, "demo.html"), "utf8")],
  "GET /threads": () => db.threads,
  "POST /threads": (b) => {
    const t = { id: "t" + (db.threads.length + 1), branch: branch(), status: "pending", createdAt: Date.now(),
      element: { selector: b.selector, text: b.text, html: b.html }, url: b.url,
      messages: [{ from: "user", text: b.comment, at: Date.now() }] };
    db.threads.push(t); save(); return t;
  },
  "POST /next": (b) => { // claim oldest pending thread on this branch
    const t = db.threads.find((x) => x.status === "pending" && x.branch === branch());
    if (!t) return null;
    t.status = "received"; t.agent = b.agent || "agent"; save(); return t;
  },
  "POST /reply": (b) => {
    const t = find(b.id); if (!t) return { error: "no such thread" };
    t.messages.push({ from: b.from || "agent", text: b.text, at: Date.now() });
    if (b.from === "user") t.status = "pending"; // user follow-up re-queues
    else if (b.ask) t.status = "waiting-on-user";
    else t.status = "replied";
    save(); return t;
  },
  "POST /resolve": (b) => { const t = find(b.id); if (!t) return { error: "no such thread" }; t.status = "resolved"; save(); return t; },
};

createServer(async (req, res) => {
  const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type", "access-control-allow-methods": "GET,POST" }; // ponytail: real build uses an origin allowlist
  if (req.method === "OPTIONS") return res.writeHead(204, cors).end();
  const path = new URL(req.url, "http://x").pathname;
  const h = routes[`${req.method} ${path}`];
  if (!h) return res.writeHead(404, cors).end();
  let body = "";
  for await (const c of req) body += c;
  const out = h(body ? JSON.parse(body) : {});
  if (Array.isArray(out) && (out[0] === "js" || out[0] === "html")) {
    return res.writeHead(200, { ...cors, "content-type": out[0] === "js" ? "text/javascript" : "text/html" }).end(out[1]);
  }
  res.writeHead(200, { ...cors, "content-type": "application/json" }).end(JSON.stringify(out));
}).listen(PORT, "127.0.0.1", () => console.log(`spike on http://127.0.0.1:${PORT}/demo`));
