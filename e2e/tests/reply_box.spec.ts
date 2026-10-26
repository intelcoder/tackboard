import { mkdirSync } from "node:fs";
import { test, expect } from "../fixtures/harness.ts";
import { openPanel, postComment, thread } from "../fixtures/states.ts";

const evidence = "/Users/fiddlest/projects/llm-debugger-board/specs/001-tackboard/evidence/T23";

test("reply box empties after Send and a second send adds nothing", async ({ harness: h }) => {
  const page = h.page;
  const id = await postComment(page, "#cta", "first comment");
  const box = page.locator(`[data-key="reply-${id}"]`);
  const messages = thread(page, id).locator(".tb-msg");

  await box.fill("my reply");
  await page.locator(`[data-key="send-${id}"]`).click();
  await expect(messages).toHaveCount(2);
  await expect(messages.filter({ hasText: "my reply" })).toHaveCount(1);
  await expect(box).toHaveValue("");
  mkdirSync(evidence, { recursive: true });
  await page.screenshot({ path: `${evidence}/after_send.png` });

  // sending again right away does nothing
  await page.locator(`[data-key="send-${id}"]`).click();
  await box.focus();
  await page.keyboard.press("Enter");
  await page.waitForTimeout(1500);
  await expect(messages).toHaveCount(2);
});

// holds the reply request until release() is called, counting every one that reaches the daemon
async function holdReplies(page: import("@playwright/test").Page) {
  let reached = 0;
  const held: Array<() => void> = [];
  await page.route("**/messages", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    reached++;
    await new Promise<void>((resolve) => held.push(resolve));
    await route.continue();
  });
  return {
    count: () => reached,
    release: () => held.splice(0).forEach((r) => r()),
  };
}

test("two sends while one is in flight add one message", async ({ harness: h }) => {
  const page = h.page;
  const id = await postComment(page, "#cta", "first comment");
  const box = page.locator(`[data-key="reply-${id}"]`);
  const send = page.locator(`[data-key="send-${id}"]`);
  const messages = thread(page, id).locator(".tb-msg");
  const held = await holdReplies(page);

  await box.fill("only once");
  await send.click();
  await expect.poll(held.count).toBe(1);
  await send.click();
  await box.focus();
  await page.keyboard.press("Enter");
  await box.evaluate((el) => {
    for (let i = 0; i < 2; i++) el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  });
  await page.waitForTimeout(500);
  expect(held.count()).toBe(1);

  held.release();
  await expect(messages).toHaveCount(2);
  await page.waitForTimeout(500);
  await expect(messages).toHaveCount(2);
  await expect(messages.filter({ hasText: "only once" })).toHaveCount(1);
  expect(held.count()).toBe(1);
});

test("text typed while a send is in flight stays in the box", async ({ harness: h }) => {
  const page = h.page;
  const id = await postComment(page, "#cta", "first comment");
  const box = page.locator(`[data-key="reply-${id}"]`);
  const messages = thread(page, id).locator(".tb-msg");
  const held = await holdReplies(page);

  await box.fill("sent part");
  await page.locator(`[data-key="send-${id}"]`).click();
  await expect.poll(held.count).toBe(1);
  await box.fill("sent part and more");
  held.release();
  await expect(messages).toHaveCount(2);
  await expect(box).toHaveValue("sent part and more");
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

test("a failed send keeps the text", async ({ harness: h }) => {
  const page = h.page;
  const id = await postComment(page, "#cta", "first comment");
  await page.route("**/messages", (route) => route.fulfill({ status: 500, contentType: "application/json", body: '{"error":"boom"}' }));
  const box = page.locator(`[data-key="reply-${id}"]`);
  await box.fill("do not lose me");
  await page.locator(`[data-key="send-${id}"]`).click();
  await expect(page.locator(".tb-banner.blocked")).toBeVisible();
  await expect(box).toHaveValue("do not lose me");
  await expect(thread(page, id).locator(".tb-msg")).toHaveCount(1);
  h.problems.length = 0;
});
