import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { brand } from "@app/shared";
import { agentArgs, writeMcpJson } from "../src/launch.ts";

const read = (dir: string) => JSON.parse(readFileSync(join(dir, ".mcp.json"), "utf8"));

test("writeMcpJson creates the file, adds beside other servers, and leaves an existing entry alone", () => {
  const dir = mkdtempSync(join(tmpdir(), "mcp-"));
  try {
    assert.equal(writeMcpJson(dir), "created");
    assert.deepEqual(read(dir).mcpServers[brand.cli].args.at(-1), "channel");
    assert.equal(writeMcpJson(dir), "present");
    writeFileSync(join(dir, ".mcp.json"), JSON.stringify({ mcpServers: { other: { command: "x" } } }));
    assert.equal(writeMcpJson(dir), "added");
    assert.deepEqual(Object.keys(read(dir).mcpServers).sort(), [brand.cli, "other"].sort());
    writeFileSync(join(dir, ".mcp.json"), "{not json");
    assert.throws(() => writeMcpJson(dir), /not valid JSON/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the headless agent may edit files and run only the reply command", () => {
  const args = agentArgs("do it");
  assert.deepEqual(args.slice(0, 2), ["-p", "do it"]);
  assert.ok(args.includes("acceptEdits"));
  assert.ok(args.includes(`--allowedTools=Bash(${brand.cli} reply:*)`));
  assert.ok(!args.some((a) => a.includes("dangerously")));
});
