// THROWAWAY SPIKE check: post -> next -> ask -> user follow-up -> reply -> resolve. Run: node check.mjs
import { spawn } from "node:child_process";
import { strict as assert } from "node:assert";
import { tmpdir } from "node:os";
import { join } from "node:path";
const PORT = 4799, base = `http://127.0.0.1:${PORT}`;
const srv = spawn("node", ["server.mjs"], { cwd: import.meta.dirname, env: { ...process.env, PORT, DATA: join(tmpdir(), `spike-${Date.now()}.json`) } });
await new Promise((r) => srv.stdout.once("data", r));
const post = (p, b) => fetch(base + p, { method: "POST", body: JSON.stringify(b) }).then((r) => r.json());
try {
  const t = await post("/threads", { selector: "body > button:nth-child(1)", text: "Go", html: "<button>Go</button>", url: "x", comment: "make it blue" });
  assert.equal(t.status, "pending");
  assert.equal((await post("/next", { agent: "a" })).status, "received");
  assert.equal(await post("/next", {}), null, "claimed thread must not be handed out twice");
  assert.equal((await post("/reply", { id: t.id, from: "a", text: "which blue?", ask: true })).status, "waiting-on-user");
  assert.equal((await post("/reply", { id: t.id, from: "user", text: "navy" })).status, "pending");
  assert.equal((await post("/next", {})).id, t.id, "follow-up re-queues");
  assert.equal((await post("/resolve", { id: t.id })).status, "resolved");
  console.log("spike check OK");
} finally { srv.kill(); }
