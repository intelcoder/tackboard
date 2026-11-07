import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { brand } from "@app/shared";

// The npm package is a different layout from the checkout (bin.js, daemon.js and the overlay side by side). Only running it shows a path that broke.
test("the built package inits, starts a daemon, serves the overlay and finds the extension", async () => {
  const root = join(import.meta.dirname, "../../..");
  execFileSync("node", [join(root, "scripts/release.ts")], { cwd: root, stdio: "ignore" });
  const bin = join(root, "release/bin.js");
  const dir = mkdtempSync(join(tmpdir(), "release-test-"));
  const port = 41000 + Math.floor(Math.random() * 2000);
  const run = (...args: string[]) => execFileSync("node", [bin, ...args], { cwd: dir, encoding: "utf8" });
  const init = run("init", "--port", String(port));
  assert.ok(init.includes("installed skill") && init.includes("installed Cursor rule"));
  assert.ok(existsSync(join(run("extension").split("\n")[0]!, "manifest.json")));
  const daemon = spawn("node", [bin, "start"], { cwd: dir, stdio: "ignore" });
  try {
    let text = "";
    for (let i = 0; i < 40 && !text; i++) {
      await new Promise((r) => setTimeout(r, 150));
      text = await fetch(`http://127.0.0.1:${port}/${brand.bundle}`).then((r) => r.text(), () => "");
    }
    assert.ok(text.includes("__TACKBOARD__"), "overlay bundle not served");
  } finally {
    daemon.kill();
    await new Promise((r) => daemon.once("exit", r));
  }
});

// The one-command path: a folder that was never set up, `start` alone, then the overlay is served and the Vite plugin is in the package.
test("the built package sets a new folder up on start, and ships the Vite plugin as tackboard/vite", async () => {
  const root = join(import.meta.dirname, "../../..");
  const bin = join(root, "release/bin.js");
  assert.ok(existsSync(bin), "run the release test above first");
  const dir = mkdtempSync(join(tmpdir(), "release-first-run-"));
  const port = 43000 + Math.floor(Math.random() * 2000);
  const daemon = spawn("node", [bin, "start", "--port", String(port)], { cwd: dir, stdio: "ignore" });
  try {
    let text = "";
    for (let i = 0; i < 40 && !text; i++) {
      await new Promise((r) => setTimeout(r, 150));
      text = await fetch(`http://127.0.0.1:${port}/${brand.bundle}`).then((r) => r.text(), () => "");
    }
    assert.ok(text.includes("__TACKBOARD__"), "overlay bundle not served after a first-run start");
    assert.ok(existsSync(join(dir, ".tackboard/config.json")), "start did not set the folder up");
    assert.ok(existsSync(join(dir, ".claude/skills/tackboard/SKILL.md")), "start did not install the skill");
  } finally {
    daemon.kill();
    await new Promise((r) => daemon.once("exit", r));
  }
  const pkg = JSON.parse(readFileSync(join(root, "release/package.json"), "utf8"));
  assert.equal(pkg.exports["./vite"], "./vite.js");
  const plugin = await import(join(root, "release/vite.js"));
  assert.equal(typeof plugin.default, "function");
  assert.deepEqual(plugin.default().map((p: { name: string }) => p.name), ["source-attr", "overlay-inject"]);
});
