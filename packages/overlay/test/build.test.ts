import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { brand } from "@app/shared";
import { findViolations } from "../../../scripts/guard.ts";
import { buildOverlay } from "../build.ts";

test("build writes one bundle file named by brand.bundle", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ov-build-"));
  try {
    await buildOverlay(dir);
    assert.deepEqual(readdirSync(dir), [brand.bundle]);
    const text = readFileSync(join(dir, brand.bundle), "utf8");
    assert.ok(text.length > 1000);
    assert.ok(text.includes(brand.hostId) || text.includes("hostId"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the bundle contains no HTML sink", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ov-build-"));
  try {
    await buildOverlay(dir);
    const text = readFileSync(join(dir, brand.bundle), "utf8");
    const sinks = findViolations([{ path: "packages/overlay/src/bundle.ts", text }]).filter((v) => v.rule === "sink");
    assert.deepEqual(sinks, []);
    assert.ok(!text.includes("node:"), "no node builtins leaked into the browser bundle");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
