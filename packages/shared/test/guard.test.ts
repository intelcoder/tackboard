import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { findViolations, scanTree } from "../../../scripts/guard.ts";

const overlay = (text: string) => findViolations([{ path: "packages/overlay/src/x.ts", text }]);

test("guard flags each banned DOM sink form", () => {
  const samples: [string, string][] = [
    ["innerHTML", "el.innerHTML = x"],
    ["outerHTML", "el.outerHTML = x"],
    ["insertAdjacentHTML", "el.insertAdjacentHTML('beforeend', x)"],
    ["document.write", "document.write(x)"],
    ["createContextualFragment", "range.createContextualFragment(x)"],
    ["DOMParser", "new DOMParser()"],
    ["setHTMLUnsafe", "el.setHTMLUnsafe(x)"],
    ["srcdoc", "iframe.srcdoc = x"],
  ];
  for (const [form, text] of samples) {
    assert.deepEqual(overlay(text).map((v) => v.form), [form], form);
  }
  assert.deepEqual(overlay("const h = el.outerHTML;"), [], "reading outerHTML is allowed");
});

test("guard flags the brand name in indirect forms", () => {
  const name = "tack" + "board";
  const samples = [
    name,
    name.toUpperCase(),
    `.${name}/`,
    `x-${name}-token`,
    `"tack" + "board"`,
  ];
  for (const s of samples) {
    const v = findViolations([{ path: "packages/daemon/src/x.ts", text: `const a = ${s};` }]);
    assert.equal(v.length, 1, s);
    assert.equal(v[0]!.rule, "brand");
  }
});

test("guard exempts brand.ts and test directories", () => {
  const text = "const a = 'tackboard'; el.innerHTML = x;";
  assert.deepEqual(findViolations([{ path: "packages/shared/src/brand.ts", text }]), []);
  assert.deepEqual(findViolations([{ path: "packages/overlay/test/a.test.ts", text }]), []);
  assert.deepEqual(findViolations([{ path: "packages/shared/test-support/a.ts", text }]), []);
});

test("real tree has no violations", () => {
  assert.deepEqual(scanTree(join(import.meta.dirname, "..", "..", "..")), []);
});
