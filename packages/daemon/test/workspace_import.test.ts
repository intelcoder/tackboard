import { test } from "node:test";
import assert from "node:assert/strict";
import { brand } from "@app/shared";
import type { ThreadStatus } from "@app/shared";

test("daemon package can import shared by package name", () => {
  const s: ThreadStatus = "pending";
  assert.equal(brand.cli, "tackboard");
  assert.equal(s, "pending");
});
