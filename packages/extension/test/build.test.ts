import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { brand } from "@app/shared";
import { buildExtension } from "../build.ts";

const manifestIn = (dir: string) => JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));

test("the manifest is version 3 with the fixed key, only storage, scripting and activeTab, a button with no popup, only optional host permissions and no content_scripts", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ext-build-"));
  try {
    await buildExtension(dir);
    const manifest = manifestIn(dir);
    assert.equal(manifest.manifest_version, 3);
    assert.equal(manifest.name, brand.name);
    assert.equal(manifest.key, brand.extensionKey);
    assert.deepEqual(manifest.permissions, ["storage", "scripting", "activeTab", "clipboardRead"]);
    assert.ok(manifest.action);
    assert.equal(manifest.action.default_popup, undefined);
    assert.deepEqual(manifest.optional_host_permissions, ["http://*/*", "https://*/*"]);
    assert.equal(manifest.host_permissions, undefined);
    assert.equal(manifest.content_scripts, undefined);
    assert.equal(manifest.background.service_worker, "background.js");
    assert.deepEqual(manifest.options_ui, { page: "options.html", open_in_tab: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("extraHostPermissions are added as host_permissions and the built files exist", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ext-build-"));
  try {
    await buildExtension(dir, ["http://localhost/*"]);
    assert.deepEqual(manifestIn(dir).host_permissions, ["http://localhost/*"]);
    for (const name of ["background.js", "content.js", "options.js", "options.html"]) assert.ok(existsSync(join(dir, name)), name);
    assert.ok(!readFileSync(join(dir, "content.js"), "utf8").includes("node:"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
