import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findConfig, readConfig, writeConfig } from "../src/config.ts";

const cfg = { port: 4310, token: "tok", origins: ["http://localhost:3000"], userName: "me" };
const tmp = () => realpathSync(mkdtempSync(join(tmpdir(), "cfg-")));

test("findConfig walks up from a nested directory", () => {
  const root = tmp();
  writeConfig(root, cfg);
  const nested = join(root, "a", "b", "c");
  mkdirSync(nested, { recursive: true });
  const found = findConfig(nested);
  assert.equal(found?.dir, root);
  assert.equal(found?.config.port, 4310);
});

test("findConfig returns null outside a project", () => {
  assert.equal(findConfig(tmp()), null);
});

test("writeConfig then readConfig round-trips", () => {
  const root = tmp();
  writeConfig(root, cfg);
  assert.deepEqual(readConfig(root), cfg);
});
