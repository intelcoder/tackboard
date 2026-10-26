import { test, expect } from "../fixtures/harness.ts";
import { openPanel, postComment } from "../fixtures/states.ts";

test("branch scoping", async ({ harness: h }) => {
  const page = h.page;
  await postComment(page, "#cta", "comment made on main");

  h.git(["checkout", "-q", "-b", "feature/x"]);
  const none = await h.agent(["next"]);
  expect(none.stdout).toContain("no pending threads");
  await openPanel(page);
  await expect(page.locator(".tb-branch")).toHaveText("feature/x", { timeout: 8000 });
  await expect(page.locator(".tb-empty")).toContainText("No comments on this branch yet");
  await expect(page.locator(".tb-pin")).toHaveCount(0);

  await postComment(page, "#l4", "comment made on feature x");
  await expect(page.locator(".tb-pin")).toHaveCount(1);
  h.git(["commit", "-q", "--allow-empty", "-m", "work on x"]);

  h.git(["checkout", "-q", "main"]);
  const main = await h.agent(["next"]);
  expect(main.stdout).toContain("comment made on main");
  expect(main.stdout).not.toContain("comment made on feature x");
  expect((await h.agent(["next"])).stdout).toContain("no pending threads");
  await expect(page.locator(".tb-branch")).toHaveText("main", { timeout: 8000 });
  await expect(page.locator(".tb-pin")).toHaveCount(1);

  // the branch is merged and deleted: its thread moves to History and has no pin
  h.git(["merge", "-q", "feature/x"]);
  h.git(["branch", "-D", "feature/x"]);
  await expect(page.locator('[data-key="history"]')).toHaveText("History (1)", { timeout: 8000 });
  await expect(page.locator(".tb-pin")).toHaveCount(1);
  await page.locator('[data-key="history"]').click();
  const row = page.locator(".tb-thread");
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("comment made on feature x");
  await expect(row).not.toContainText("comment made on main");
});
