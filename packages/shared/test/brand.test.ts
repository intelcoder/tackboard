import { test } from "node:test";
import assert from "node:assert/strict";
import { brand } from "../src/brand.ts";
import { createHash } from "node:crypto";

test("brand fields have the expected values", () => {
  assert.equal(brand.cli, "tackboard");
  assert.equal(brand.dataDir, ".tackboard");
  assert.equal(brand.refPrefix, "refs/tackboard/");
  assert.equal(brand.bundle, "tackboard.js");
  assert.equal(brand.envPrefix, "TACKBOARD_");
});

test("extensionOrigin is the id of extensionKey", () => {
  const der = Buffer.from(brand.extensionKey, "base64");
  const hex = createHash("sha256").update(der).digest("hex").slice(0, 32);
  const id = [...hex].map((h) => String.fromCharCode(97 + parseInt(h, 16))).join("");
  assert.equal(brand.extensionOrigin, `chrome-extension://${id}`);
});
