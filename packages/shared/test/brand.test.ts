import { test } from "node:test";
import assert from "node:assert/strict";
import { brand } from "../src/brand.ts";

test("brand fields have the expected values", () => {
  assert.equal(brand.cli, "tackboard");
  assert.equal(brand.dataDir, ".tackboard");
  assert.equal(brand.refPrefix, "refs/tackboard/");
  assert.equal(brand.bundle, "tackboard.js");
  assert.equal(brand.envPrefix, "TACKBOARD_");
});
