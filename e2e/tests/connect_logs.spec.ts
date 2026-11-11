import { test, expect } from "../fixtures/harness.ts";
import { postComment } from "../fixtures/states.ts";

test("an empty claim says why, and the daemon log shows the comment and the claim", async ({ harness: h }) => {
  await h.restartDaemon({ TACKBOARD_DEBUG: "1" }); // the log file is dev mode only
  await postComment(h.page, "#cta", "comment made on main");

  h.git(["checkout", "-q", "-b", "feature/x"]);
  const none = await h.agent(["next"]);
  expect(none.stdout).toContain("no pending threads on this branch");
  expect(none.stdout).toContain("1 on main waiting (you asked for feature/x");

  h.git(["checkout", "-q", "main"]);
  expect((await h.agent(["next"])).stdout).toContain("comment made on main");
  const after = await h.agent(["next"]);
  expect(after.stdout).toContain("1 on main already taken by an agent");

  const logs = (await h.agent(["logs"])).stdout;
  expect(logs).toMatch(/comment +#1 t\d+ branch=main/);
  expect(logs).toMatch(/claim +ai-agent branch=main -> #1/);
});
