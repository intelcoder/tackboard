import { test, expect } from "../fixtures/harness.ts";
import { postComment } from "../fixtures/states.ts";

test("claim race", async ({ harness: h }) => {
  const posted = [await postComment(h.page, "#cta", "one"), await postComment(h.page, "#l4", "two"), await postComment(h.page, "#l2", "three")];
  expect(new Set(posted).size).toBe(3);

  const runs = await Promise.all(Array.from({ length: 10 }, () => h.agent(["next"])));
  for (const run of runs) expect(run.code).toBe(0);
  const printed = runs.flatMap((run) => [...run.stdout.matchAll(/^THREAD (\S+)/gm)].map((m) => m[1]!));

  // every comment was handed out once, and none twice
  expect(printed).toHaveLength(3);
  expect(new Set(printed).size).toBe(3);
  expect([...printed].sort()).toEqual([...posted].sort());
  // each run either got threads or was told there were none; no run was left out
  const got = runs.filter((run) => run.stdout.includes("THREAD "));
  const none = runs.filter((run) => run.stdout.includes("no pending threads"));
  expect(got.length + none.length).toBe(10);
});
