import { test } from "node:test";
import assert from "node:assert/strict";
import { redactText, SECRET_ATTR, stripQuery } from "../src/redact.ts";

test("redactText hides emails, phone and card numbers, tokens and keys", () => {
  assert.equal(redactText("mail sam.rivera+x@example.co.uk now"), "mail [email] now");
  assert.equal(redactText("call +1 (555) 014-2000 today"), "call [phone] today");
  assert.equal(redactText("card 4242 4242 4242 4242 ok"), "card [card] ok");
  assert.equal(redactText("ssn 123-45-6789"), "ssn [phone]");
  assert.equal(redactText("key sk-live_abcdefghijklmnop1234"), "key [secret]");
  assert.equal(redactText("ghp_abcdefghijklmnopqrstuvwx"), "[secret]");
  assert.equal(redactText("AKIAABCDEFGHIJKLMNOP"), "[secret]");
  assert.equal(redactText("Authorization: Bearer abc.def-ghi_jklmnop123"), "Authorization: Bearer [secret]");
  assert.equal(redactText("t=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.abc123def456"), "t=[secret]");
  assert.equal(redactText("id 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08"), "id [secret]");
});

test("redactText leaves prices, dates, times, short numbers, words and class names alone", () => {
  for (const ok of ["$3.25", "2026-11-07", "7:00 to 17:00", "12 Mill Lane", "Cinnamon roll", "product-card lowered", "width 1512x801", "(555) 0142", "v0.3.0", "SomeVeryLongCamelCaseIdentifierWithoutDigitsAtAll"]) {
    assert.equal(redactText(ok), ok, ok);
  }
});

test("stripQuery drops the query string and fragment", () => {
  assert.equal(stripQuery("https://x.test/a/b?token=1&e=a@b.c#top"), "https://x.test/a/b?…");
  assert.equal(stripQuery("/path#frag"), "/path");
  assert.equal(stripQuery("/plain"), "/plain");
});

test("SECRET_ATTR matches credential-like attribute names only", () => {
  for (const yes of ["data-token", "data-api-key", "csrf", "x-auth-code", "data-session-id", "password"]) assert.ok(SECRET_ATTR.test(yes), yes);
  for (const no of ["class", "id", "data-testid", "href", "aria-label", "data-tb-src", "author"]) assert.ok(!SECRET_ATTR.test(no), no);
});

test("redactText stays fast on very long unbroken strings", () => {
  const started = Date.now();
  for (const evil of ["h".repeat(1024 * 1024), "a-".repeat(500_000), "1 ".repeat(500_000), `${"a.".repeat(20_000)}@`, `${"a".repeat(30_000)}@x`]) redactText(evil);
  assert.ok(Date.now() - started < 1000, `took ${Date.now() - started} ms`);
});
