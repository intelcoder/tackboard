import { test, expect } from "../fixtures/harness.ts";
import { postComment } from "../fixtures/states.ts";

test("doctor on a real daemon: fine, then the agent shows up", async ({ harness: h }) => {
  const first = await h.agent(["doctor"]);
  expect(first.code).toBe(0);
  expect(first.stdout).toMatch(/ok +daemon +serves this folder/);
  expect(first.stdout).toMatch(/ok +branch +main/);
  expect(first.stdout).toMatch(/warn +agent +no agent has asked/);

  await postComment(h.page, "#cta", "look at this");
  await h.agent(["next"]);
  expect((await h.agent(["doctor"])).stdout).toMatch(/ok +agent +ai-agent asked \d+ s ago/);
});
