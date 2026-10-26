import { existsSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { test, expect } from "../fixtures/harness.ts";
import { chip, openPanel, postComment, shot, thread } from "../fixtures/states.ts";

test("restore", async ({ harness: h }) => {
  const page = h.page;
  const file = (name: string) => join(h.repo, name);
  writeFileSync(file("keep.txt"), "original keep\n");
  writeFileSync(file("gone.txt"), "original gone\n");
  h.git(["add", "-A"]);
  h.git(["commit", "-q", "-m", "tracked files"]);

  const id = await postComment(page, "#cta", "restore me");
  const row = thread(page, id);
  const claimed = await h.agent(["next"]);
  expect(claimed.stdout).toContain(id);
  await expect(chip(page, id)).toHaveText("received", { timeout: 4000 });

  // while the thread is claimed, Rewind is disabled with its reason, and Release enables it
  await row.locator(".tb-restore button").first().click();
  const confirm = page.locator(".tb-confirm");
  await expect(confirm).toBeVisible();
  const rewind = confirm.locator(".tb-btn.danger");
  await expect(rewind).toBeDisabled();
  await expect(confirm.locator(".tb-reason")).not.toBeEmpty();
  await row.locator(`[data-key="release-${id}"]`).click();
  await expect(rewind).toBeEnabled({ timeout: 4000 });
  await expect(confirm.locator(".tb-reason")).toHaveCount(0);
  await confirm.locator("[data-keep]").click();
  await expect(confirm).toHaveCount(0);

  // the agent claims it again, edits files, replies and resolves
  expect((await h.agent(["next"])).stdout).toContain(id);
  writeFileSync(file("keep.txt"), "edited by the agent\n");
  writeFileSync(file("fresh.txt"), "new file\n");
  rmSync(file("gone.txt"));
  expect((await h.agent(["reply", id, "changed three files"])).code).toBe(0);
  expect((await h.agent(["resolve", id])).code).toBe(0);

  // restore to the first message
  await page.locator('[data-key="tab-resolved"]').click();
  await expect(chip(page, id)).toHaveText("resolved", { timeout: 8000 });
  if ((await row.getAttribute("class"))?.includes("active") !== true) await row.locator(`[data-key="top-${id}"]`).first().click();
  await row.locator(".tb-restore button").first().click();
  await expect(confirm.locator(".tb-btn.danger")).toBeEnabled();
  await shot(page, "restore-confirm");
  await confirm.locator(".tb-btn.danger").click();

  await expect.poll(() => h.git(["status", "--porcelain"])).toBe("");
  expect(readFileSync(file("keep.txt"), "utf8")).toBe("original keep\n");
  expect(readFileSync(file("gone.txt"), "utf8")).toBe("original gone\n");
  expect(existsSync(file("fresh.txt"))).toBe(false);
  expect(h.git(["status", "--porcelain"])).toBe("");

  // the later messages are discarded and shown in History
  await page.locator('[data-key="history"]').click();
  const old = page.locator(".tb-thread");
  await old.locator(".tb-thread-top").first().click();
  await expect(old.locator(".tb-msg.tb-discarded")).toContainText("changed three files");
  await expect(old.locator(".tb-msg.tb-discarded .tb-chip")).toHaveText("discarded");
  await shot(page, "restore-history");

  // the agent's next call starts with the notice, which repeats until ack
  const notice = await h.agent(["next"]);
  expect(notice.stdout.startsWith("NOTICE ")).toBe(true);
  for (const name of ["keep.txt", "fresh.txt"]) expect(notice.stdout).toContain(name);
  expect((await h.agent(["status"])).stdout.startsWith("NOTICE ")).toBe(true);
  expect((await h.agent(["ack"])).code).toBe(0);
  expect((await h.agent(["status"])).stdout).not.toContain("NOTICE");

  // restore to the system message brings the agent's edits back
  await page.locator('[data-key="back"]').click();
  await page.locator('[data-key="tab-resolved"]').click();
  if (!(await row.getAttribute("class"))?.includes("active")) await row.locator(`[data-key="top-${id}"]`).first().click();
  const system = page.locator(".tb-msg.system");
  await expect(system.first()).toContainText("Restored to message");
  await system.first().locator("xpath=following-sibling::*[1]").locator("button").click();
  await expect(confirm.locator(".tb-btn.danger")).toBeEnabled({ timeout: 4000 });
  await confirm.locator(".tb-btn.danger").click();
  await expect.poll(() => (existsSync(file("fresh.txt")) ? readFileSync(file("fresh.txt"), "utf8") : null)).toBe("new file\n");
  expect(readFileSync(file("keep.txt"), "utf8")).toBe("edited by the agent\n");
  expect(existsSync(file("gone.txt"))).toBe(false);
});
