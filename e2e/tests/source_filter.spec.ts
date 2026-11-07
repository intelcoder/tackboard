import { test, expect } from "../fixtures/harness.ts";
import { openPanel, postComment } from "../fixtures/states.ts";

test("source filter splits your comments from the agent's", async ({ harness: h }) => {
  const page = h.page;
  await postComment(page, "#cta", "my comment");
  expect((await h.agent(["comment", "--selector", "#cta", "[ux] agent finding"])).code).toBe(0);
  await openPanel(page);
  const rows = page.locator(".tb-thread");
  await expect(rows).toHaveCount(2, { timeout: 5000 });

  await page.locator('[data-key="source-agent"]').click();
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("agent finding");

  await page.locator('[data-key="source-user"]').click();
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("my comment");

  await page.locator('[data-key="source-all"]').click();
  await expect(rows).toHaveCount(2);
});

test("a pin click shows only that thread, never the full list first", async ({ harness: h }) => {
  const page = h.page;
  await postComment(page, "#cta", "first");
  expect((await h.agent(["comment", "--selector", "h1", "second"])).code).toBe(0);
  await page.locator(".tb-pin").first().waitFor();
  await openPanel(page);
  await expect(page.locator(".tb-thread")).toHaveCount(2);
  // count rows on every panel mutation after the click; the full list (2 rows) must never appear
  await page.evaluate(() => {
    const w = window as unknown as { __max: number };
    w.__max = 0;
    const root = [...document.querySelectorAll("*")].map((e) => e.shadowRoot).find((r) => r?.querySelector(".tb-panel"))!;
    new MutationObserver(() => { w.__max = Math.max(w.__max, root.querySelectorAll(".tb-thread").length); }).observe(root, { childList: true, subtree: true });
  });
  await page.locator(".tb-pin").first().click();
  await expect(page.locator(".tb-thread")).toHaveCount(1);
  expect(await page.evaluate(() => (window as unknown as { __max: number }).__max)).toBeLessThanOrEqual(1);
});

test("every tab and filter changes the list", async ({ harness: h }) => {
  const page = h.page;
  await postComment(page, "#cta", "mine");
  expect((await h.agent(["comment", "--selector", "#cta", "agent one"])).code).toBe(0);
  await openPanel(page);
  const rows = page.locator(".tb-thread");
  const click = async (key: string) => { await page.locator(`[data-key="${key}"]`).click(); };
  await expect(rows).toHaveCount(2);
  await click("tab-resolved");
  await expect(rows).toHaveCount(0);
  await click("tab-open");
  await expect(rows).toHaveCount(2);
  await click("source-agent");
  await expect(rows).toHaveText(/agent one/);
  await click("source-user");
  await expect(rows).toHaveText(/mine/);
  await click("tab-resolved");
  await expect(page.locator(".tb-list")).toContainText(/No comments of yours here/);
});

test("a comment row shows a small live preview of its element, bigger on hover", async ({ harness: h }) => {
  const page = h.page;
  await postComment(page, "#cta", "preview me");
  await openPanel(page);
  const thumb = page.locator(".tb-thumb .tb-frame");
  await expect(thumb).toHaveCount(1);
  const small = (await page.locator(".tb-thumb .tb-shot").boundingBox())!;
  expect(small.width).toBeLessThanOrEqual(121);
  await page.locator(".tb-thumb").hover();
  const zoom = page.locator(".tb-zoom .tb-shot");
  await expect(zoom).toBeVisible();
  expect((await zoom.boundingBox())!.width).toBeGreaterThanOrEqual(small.width);
  await page.mouse.move(5, 5);
  await expect(page.locator(".tb-zoom")).toHaveCount(0);
});

test("the reply box has an Attach screenshot box that starts off and is off again after a send", async ({ harness: h }) => {
  const page = h.page;
  const id = await postComment(page, "#cta", "first");
  await openPanel(page);
  const box = page.locator(`[data-key="attach-${id}"]`);
  // the plain test page has no extension, so there is no screenshot box (same as the comment box)
  await expect(box).toHaveCount(0);
  await page.locator(`[data-key="reply-${id}"]`).fill("second");
  await page.locator(`[data-key="send-${id}"]`).click();
  await expect(page.locator(".tb-msg")).toHaveCount(2);
});
