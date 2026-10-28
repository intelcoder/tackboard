import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { brand } from "../../packages/shared/src/brand.ts";
import { test, expect } from "../fixtures/harness.ts";
import { chip, openPanel, postComment, thread } from "../fixtures/states.ts";

test("persistence", async ({ harness: h }) => {
  const page = h.page;
  const token = await page.evaluate((name) => (globalThis as any)[name].token as string, brand.configGlobal);
  const headers = { [brand.tokenHeader]: token };
  const threads = async () => {
    const body = (await (await fetch(`${h.daemonUrl}/threads`, { headers })).json()) as { threads: unknown[]; history: unknown[] };
    return { threads: body.threads, history: body.history };
  };
  const notices = async () => (await (await fetch(`${h.daemonUrl}/notices?agent=claude-main`, { headers })).json()) as { notices: unknown[] };

  // build up state: a resolved thread with a discarded reply, a later thread that the restore discards, and a pending notice
  const first = await postComment(page, "#cta", "first comment");
  expect((await h.agent(["next"])).stdout).toContain(first);
  const second = await postComment(page, "#l4", "second comment");
  writeFileSync(join(h.repo, "edited.txt"), "made by the agent\n");
  await h.agent(["reply", first, "I made a file"]);
  await thread(page, first).locator(`[data-key="top-${first}"]`).first().click();
  await thread(page, first).locator(`[data-key="resolve-${first}"]`).click();
  await page.locator('[data-key="tab-resolved"]').click();
  await expect(chip(page, first)).toHaveText("resolved", { timeout: 8000 });
  await thread(page, first).locator(`[data-key="top-${first}"]`).first().click();
  await thread(page, first).locator(".tb-restore button").first().click();
  await page.locator(".tb-confirm .tb-btn.danger").click();
  await expect.poll(async () => (await notices()).notices.length).toBe(1);

  const before = { list: await threads(), notices: await notices() };
  expect(JSON.stringify(before.list)).toContain('"discarded":true');
  expect(JSON.stringify(before.list)).toContain(second);

  await h.restartDaemon();

  const after = { list: await threads(), notices: await notices() };
  expect(after.list).toEqual(before.list);
  expect(after.notices).toEqual(before.notices);

  await page.reload();
  await page.locator(".tb-modes").waitFor();
  await openPanel(page);
  await page.locator('[data-key="tab-resolved"]').click();
  await expect(chip(page, first)).toHaveText("resolved");
  await expect(page.locator('[data-key="history"]')).toHaveText("History (1)");
  await page.locator('[data-key="history"]').click();
  await expect(page.locator(".tb-thread")).toHaveCount(2);
  // the restore went back before the second thread began, so that whole thread is discarded
  await expect(thread(page, second).locator(".tb-chip")).toHaveText("discarded");
  await thread(page, first).locator(".tb-thread-top").click();
  await expect(thread(page, first).locator(".tb-msg.tb-discarded")).toContainText("I made a file");

  // the notice is still waiting for the agent, and the claimed snapshot is still in the log
  const next = await h.agent(["next"]);
  expect(next.stdout.startsWith("NOTICE ")).toBe(true);
  expect(next.stdout).toContain("edited.txt");
  const log = await h.agent(["history", first]);
  expect(log.code).toBe(0);
  expect(log.stdout).toContain("claimed");
  expect(log.stdout).toContain("first comment");
  expect(log.stdout).toContain("#cta");
});
