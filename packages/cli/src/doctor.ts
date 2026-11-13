import { existsSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { agentState, ago, brand, findConfig, paths } from "@app/shared";
import type { HealthResponse, ListThreadsResponse } from "@app/shared";
import { currentBranch } from "./client.ts";

type Check = { level: "ok" | "warn" | "FAIL"; name: string; text: string; fix?: string };

const same_folder = (a: string, b: string) => {
  try {
    return realpathSync(a) === realpathSync(b);
  } catch {
    return a === b;
  }
};

/** Checks each link from this folder to the agent and prints what to run for the ones that are off. FAIL stops comments reaching the agent; warn may be fine. */
export async function doctor(cwd: string, now = Date.now()): Promise<{ text: string; ok: boolean }> {
  const checks: Check[] = [];
  const done = () => ({
    text: checks.map((c) => `${c.level.padEnd(4)}  ${c.name.padEnd(9)} ${c.text}${c.fix ? `\n${" ".repeat(16)}fix: ${c.fix}` : ""}`).join("\n"),
    ok: !checks.some((c) => c.level === "FAIL"),
  });

  const found = findConfig(cwd);
  if (!found) {
    checks.push({ level: "FAIL", name: "folder", text: `no ${brand.cli} project here or above`, fix: `${brand.cli} start` });
    return done();
  }
  const { dir, config } = found;
  const base = `http://127.0.0.1:${config.port}`;
  const headers = { [brand.tokenHeader]: config.token };
  checks.push({ level: "ok", name: "folder", text: `${dir}, port ${config.port}` });

  let health: HealthResponse | undefined;
  try {
    const res = await fetch(base + paths.health, { headers, signal: AbortSignal.timeout(1500) });
    health = (await res.json()) as HealthResponse;
  } catch {
    // Reported below.
  }
  if (!health) {
    checks.push({ level: "FAIL", name: "daemon", text: `nothing answers on port ${config.port}`, fix: `${brand.cli} start` });
    return done();
  }
  if (!health.dir) {
    checks.push({
      level: "FAIL",
      name: "daemon",
      text: `something answers on port ${config.port} but it does not accept this folder's token, so it belongs to another project`,
      fix: `stop it (lsof -nP -iTCP:${config.port} -sTCP:LISTEN), then ${brand.cli} start here`,
    });
    return done();
  }
  if (!same_folder(health.dir, dir)) {
    checks.push({ level: "FAIL", name: "daemon", text: `answers, but serves ${health.dir}, not this folder`, fix: `stop it, then ${brand.cli} start here` });
  } else {
    checks.push({ level: "ok", name: "daemon", text: `serves this folder` });
  }

  const mine = currentBranch(cwd);
  if (mine && health.branch && mine !== health.branch) {
    checks.push({
      level: "FAIL",
      name: "branch",
      text: `the daemon is on ${health.branch}, this folder is on ${mine}: comments are filed under ${health.branch}, and next only reads ${mine}`,
      fix: `check out ${health.branch} here, or run the agent in the folder the daemon serves`,
    });
  } else {
    checks.push({ level: "ok", name: "branch", text: health.branch ?? "no git here" });
  }

  checks.push(
    health.origins?.length
      ? { level: "ok", name: "origins", text: health.origins.join(", ") }
      : { level: "warn", name: "origins", text: "none allowed: the script tag cannot send comments", fix: `${brand.cli} init --origin http://localhost:3000` },
  );

  checks.push(
    health.pairedAt
      ? { level: "ok", name: "extension", text: `paired ${ago(now - health.pairedAt)}` }
      : { level: "warn", name: "extension", text: "has not paired since the daemon started (fine if you use the script tag)", fix: "open a site you added in Chrome, then reload the tab" },
  );

  checks.push(
    existsSync(join(dir, ".claude", "skills", brand.cli, "SKILL.md"))
      ? { level: "ok", name: "skill", text: `.claude/skills/${brand.cli}/SKILL.md` }
      : { level: "warn", name: "skill", text: "not installed here: the agent has to be told what to do", fix: `${brand.cli} init, or tell the agent: run \`${brand.cli} wait\`` },
  );

  try {
    const res = await fetch(base + paths.threads, { headers, signal: AbortSignal.timeout(1500) });
    const { agent } = (await res.json()) as ListThreadsResponse;
    const ask = `tell the agent: run \`${brand.cli} wait\``;
    checks.push(
      agent.name === null || agent.seenAt === null
        ? { level: "warn", name: "agent", text: "no agent has asked for comments yet", fix: ask }
        : agentState(agent, now, brand.cli).kind === "listening" || agentState(agent, now, brand.cli).kind === "idle"
          ? { level: "ok", name: "agent", text: `${agent.name} asked ${ago(now - agent.seenAt)}` }
          : { level: "warn", name: "agent", text: `${agent.name} last asked ${ago(now - agent.seenAt)}`, fix: ask },
    );
  } catch {
    checks.push({ level: "warn", name: "agent", text: "could not read the agent state" });
  }
  return done();
}
