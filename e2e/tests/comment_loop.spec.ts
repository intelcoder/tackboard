import { test, expect } from "../fixtures/harness.ts";
import { badge, chip, closePanel, openPanel, panelToggle, postComment, shot, thread } from "../fixtures/states.ts";

const idOf = (text: string) => /THREAD (\S+)/.exec(text)![1]!;

test("comment loop", async ({ harness: h }) => {
  const page = h.page;
  await page.locator(".tb-modes [data-mode=comment]").click();
  await page.hover("#cta");
  const outline = page.locator(".tb-outline");
  await expect(outline).toBeVisible();
  const color = await outline.evaluate((el) => getComputedStyle(el).borderTopColor);
  const [r, g, b] = color.match(/\d+/g)!.map(Number) as [number, number, number];
  expect(b).toBeGreaterThan(r);
  expect(b).toBeGreaterThan(150);
  await page.click("#cta");
  await page.locator('[data-key="composer"]').fill("Make this blue");
  await page.locator('[data-key="send"]').click();
  const active = page.locator(".tb-thread.active");
  await expect(active).toBeVisible();
  const id = (await active.getAttribute("data-id"))!;
  await expect(chip(page, id)).toHaveText("pending");

  const next = await h.agent(["next"]);
  expect(next.code).toBe(0);
  expect(next.stdout).toContain("Make this blue");
  expect(next.stdout).toContain("#cta");
  expect(idOf(next.stdout)).toBe(id);
  await expect(chip(page, id)).toHaveText("received", { timeout: 3000 });
  await expect(page.locator(".tb-toast")).toHaveText("claude-main received your comment");

  const ask = await h.agent(["reply", id, "which blue?", "--ask"]);
  expect(ask.code).toBe(0);
  await expect(chip(page, id)).toHaveText("waiting on you", { timeout: 3000 });
  await expect(thread(page, id)).toContainText("which blue?");
  await closePanel(page);
  await expect(badge(page)).toHaveText("1");
  await openPanel(page);

  await thread(page, id).locator(`[data-key="reply-${id}"]`).fill("the logo blue");
  await thread(page, id).locator(`[data-key="send-${id}"]`).click();
  await expect(chip(page, id)).toHaveText("pending");
  const again = await h.agent(["next"]);
  expect(idOf(again.stdout)).toBe(id);
  expect(again.stdout).toContain("the logo blue");
  await h.agent(["reply", id, "made it the logo blue. Is it OK to close this?", "--ask"]);
  await expect(chip(page, id)).toHaveText("waiting on you", { timeout: 3000 });

  await thread(page, id).locator(`[data-key="resolve-${id}"]`).click();
  await expect(thread(page, id)).toHaveCount(0);
  await page.locator('[data-key="tab-resolved"]').click();
  await expect(chip(page, id)).toHaveText("resolved");
  await shot(page, "comment_loop");
});

test("the agent cannot resolve a thread", async ({ harness: h }) => {
  const id = await postComment(h.page, "#cta", "Make this blue");
  await h.agent(["next"]);
  const r = await h.agent(["resolve", id]);
  expect(r.code).toBe(1);
  expect(r.stdout).toContain("only the user closes a thread");
  await expect(chip(h.page, id)).toHaveText("received");
});

test("agent-started thread", async ({ harness: h }) => {
  const page = h.page;
  const started = await h.agent(["comment", "--selector", "#cta", "Is this copy final?", "--mention", "me"]);
  expect(started.code).toBe(0);
  await expect(badge(page)).toHaveText("1", { timeout: 4000 });
  await openPanel(page);
  const row = page.locator(".tb-thread").first();
  await expect(row.locator(".tb-chip")).toHaveText("waiting on you");
  await row.locator(".tb-thread-top").click();
  await expect(row).toContainText("claude-main");
  await expect(row).toContainText("@sam Is this copy final?");
});

test("user can reopen and release", async ({ harness: h }) => {
  const page = h.page;
  const first = await postComment(page, "#cta", "first comment");
  expect(idOf((await h.agent(["next"])).stdout)).toBe(first);
  await thread(page, first).locator(`[data-key="resolve-${first}"]`).click();
  await page.locator('[data-key="tab-resolved"]').click();
  await thread(page, first).locator(".tb-thread-top").click();
  await thread(page, first).locator(`[data-key="reopen-${first}"]`).click();
  await page.locator('[data-key="tab-open"]').click();
  await expect(chip(page, first)).toHaveText("pending");

  const second = await postComment(page, "#l4", "second comment");
  expect(second).not.toBe(first);
  // the oldest pending thread is claimed first, so claim the reopened one and then the new one
  expect(idOf((await h.agent(["next"])).stdout)).toBe(first);
  expect(idOf((await h.agent(["next"])).stdout)).toBe(second);
  await expect(chip(page, second)).toHaveText("received", { timeout: 3000 });
  await thread(page, second).locator(`[data-key="release-${second}"]`).click();
  await expect(chip(page, second)).toHaveText("pending");
  expect(idOf((await h.agent(["next"])).stdout)).toBe(second);
  await shot(page, "reopen_release");
  void panelToggle;
});
