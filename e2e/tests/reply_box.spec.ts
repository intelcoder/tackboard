import { test, expect } from "../fixtures/harness.ts";
import { openPanel, postComment, thread } from "../fixtures/states.ts";

test("reply box empties at once and the reply shows once", async ({ harness: h }) => {
  const page = h.page;
  const id = await postComment(page, "#cta", "first comment");
  const box = page.locator(`[data-key="reply-${id}"]`);
  const messages = thread(page, id).locator(".tb-msg");

  await box.fill("my reply");
  await page.locator(`[data-key="send-${id}"]`).click();
  await expect(box).toHaveValue("");
  await expect(messages).toHaveCount(2);
  await expect(messages.filter({ hasText: "my reply" })).toHaveCount(1);
  await expect(thread(page, id).locator(".tb-queued")).toHaveCount(0);
});

test("a second Send queues behind the first and both arrive in order", async ({ harness: h }) => {
  const page = h.page;
  const id = await postComment(page, "#cta", "first comment");
  const box = page.locator(`[data-key="reply-${id}"]`);
  const send = page.locator(`[data-key="send-${id}"]`);
  const messages = thread(page, id).locator(".tb-msg .text");
  let reached = 0;
  let open = false;
  const waiting: Array<() => void> = [];
  await page.route("**/messages", async (route) => {
    reached++;
    if (!open) await new Promise<void>((resolve) => waiting.push(resolve));
    await route.continue();
  });

  await box.fill("one");
  await send.click();
  await expect.poll(() => reached).toBe(1);
  await box.fill("two");
  await send.click();
  await expect(box).toHaveValue("");
  await expect(thread(page, id).locator(".tb-queued")).toHaveCount(2);
  await page.waitForTimeout(500);
  expect(reached).toBe(1);

  open = true;
  waiting.splice(0).forEach((resolve) => resolve());
  await expect(messages).toHaveText(["first comment", "one", "two"]);
  await expect(thread(page, id).locator(".tb-queued")).toHaveCount(0);
});

test("reply draft survives switching threads", async ({ harness: h }) => {
  const page = h.page;
  const first = await postComment(page, "#cta", "one");
  const second = await postComment(page, "#l1", "two");
  await openPanel(page);
  await page.locator(`.tb-thread-top[data-key="top-${first}"]`).click();
  await page.locator(`[data-key="reply-${first}"]`).fill("half written");
  await page.locator(`.tb-thread-top[data-key="top-${second}"]`).click();
  await expect(thread(page, second)).toHaveClass(/active/);
  await page.locator(`.tb-thread-top[data-key="top-${first}"]`).click();
  await expect(page.locator(`[data-key="reply-${first}"]`)).toHaveValue("half written");
});

test("a failed reply shows as an item and the box is not refilled", async ({ harness: h }) => {
  const page = h.page;
  const id = await postComment(page, "#cta", "first comment");
  await page.route("**/messages", (route) => route.fulfill({ status: 500, contentType: "application/json", body: '{"error":"internal","message":"boom"}' }));
  const box = page.locator(`[data-key="reply-${id}"]`);
  await box.fill("do not lose me");
  await page.locator(`[data-key="send-${id}"]`).click();
  const item = thread(page, id).locator(".tb-queued");
  await expect(item).toContainText("do not lose me");
  await expect(item).toContainText("Not sent");
  await expect(item).toContainText("boom");
  await expect(box).toHaveValue("");
  await expect(thread(page, id).locator(".tb-msg")).toHaveCount(1);
  h.problems.length = 0;
});
