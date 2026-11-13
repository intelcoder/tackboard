import { test } from "node:test";
import assert from "node:assert/strict";
import { onPage } from "../src/domain/page.ts";

test("a path matches the page's path; a hash, a query on the wanted path and a trailing slash do not count", () => {
  assert.equal(onPage("http://localhost:3000/pricing", "/pricing"), true);
  assert.equal(onPage("http://localhost:3000/pricing/", "/pricing"), true);
  assert.equal(onPage("http://localhost:3000/pricing#plans", "/pricing"), true);
  assert.equal(onPage("http://localhost:3000/pricing?tab=2", "/pricing?x=1"), true);
  assert.equal(onPage("http://localhost:3000/", "/"), true);
  assert.equal(onPage("http://localhost:3000/pricing", "/pric"), false);
  assert.equal(onPage("http://localhost:3000/pricing/team", "/pricing"), false);
});

test("a whole address must match the whole page; a thread with no page never matches", () => {
  assert.equal(onPage("http://localhost:3000/pricing", "http://localhost:3000/pricing/"), true);
  assert.equal(onPage("http://localhost:3000/pricing", "http://localhost:3001/pricing"), false);
  assert.equal(onPage("", "/pricing"), false);
  assert.equal(onPage("not a url", "/pricing"), false);
});
