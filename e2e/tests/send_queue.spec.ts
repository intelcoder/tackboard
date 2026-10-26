import type { Locator, Page, Route } from "@playwright/test";
import { test, expect } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";
import { outline, postComment, setMode, thread } from "../fixtures/states.ts";

const composer = (page: Page) => page.locator('[data-key="composer"]');
const queued = (page: Page) => page.locator(".tb-queued");

async function openComposer(page: Page, selector: string) {
  await setMode(page, "comment");
  await page.hover(selector);
  await outline(page).waitFor();
  await page.click(selector);
  await composer(page).waitFor();
}

const posts = (path: string) => (url: URL) => url.pathname.endsWith(path);

/** Fails every POST to this path before any answer, like a daemon that is not running. */
async function unreachable(page: Page, path: string) {
  const handler = (route: import("@playwright/test").Route) =>
    route.request().method() === "POST" ? route.abort("connectionrefused") : route.continue();
  const match = posts(path);
  await page.route(match, handler);
  return () => page.unroute(match, handler);
}

test("Enter sends in the new comment box and Shift+Enter adds a line", async ({ harness: h }) => {
  const page = h.page;
  await openComposer(page, "#cta");
  await composer(page).fill("a");
  await composer(page).press("Shift+Enter");
  await composer(page).pressSequentially("b");
  await page.waitForTimeout(300);
  await expect(composer(page)).toHaveValue("a\nb");
  await expect(page.locator(".tb-thread")).toHaveCount(0);

  await composer(page).press("Enter");
  await expect(composer(page)).toHaveCount(0);
  await expect(page.locator(".tb-thread.active .tb-msg .text")).toHaveText("a\nb");
});

for (const which of ["reply box", "new comment box"] as const) {
  test(`Enter does nothing while an input method is composing in the ${which}`, async ({ harness: h }) => {
    const page = h.page;
    let box;
    if (which === "reply box") {
      const id = await postComment(page, "#cta", "first comment");
      box = page.locator(`[data-key="reply-${id}"]`);
    } else {
      await openComposer(page, "#cta");
      box = composer(page);
    }
    await box.fill("half typed");
    await box.focus();

    // a real composition, started through the browser's input method channel
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Input.imeSetComposition", { text: "ㅎ", selectionStart: 1, selectionEnd: 1 });
    await page.keyboard.press("Enter");
    // and a key event that says it is part of a composition
    await box.evaluate((el) => {
      el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", isComposing: true, bubbles: true, cancelable: true }));
      el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", keyCode: 229, bubbles: true, cancelable: true }));
    });
    await page.waitForTimeout(500);
    await expect(queued(page)).toHaveCount(0);
    await expect(page.locator(".tb-thread .tb-msg")).toHaveCount(which === "reply box" ? 1 : 0);
    expect(await box.inputValue()).toContain("half typed");
  });
}

test("an unreachable daemon queues a comment and a reply, and both arrive once it is back", async ({ harness: h }) => {
  const page = h.page;
  const id = await postComment(page, "#cta", "first comment");
  const reply = page.locator(`[data-key="reply-${id}"]`);
  const back_threads = await unreachable(page, "/threads");
  const back_messages = await unreachable(page, "/messages");

  await openComposer(page, "#l4");
  await composer(page).fill("new while offline");
  await composer(page).press("Enter");
  await expect(composer(page)).toHaveCount(0);
  const waiting = page.locator(".tb-queue .tb-queued");
  await expect(waiting).toHaveCount(1);
  await expect(waiting).toContainText("new while offline");
  await expect(waiting).toContainText("div#l4");
  await expect(waiting).toContainText("Waiting to retry");

  await page.locator(`.tb-thread-top[data-key="top-${id}"]`).click();
  await reply.fill("reply while offline");
  await reply.press("Enter");
  await expect(reply).toHaveValue("");
  await expect(thread(page, id).locator(".tb-queued")).toContainText("reply while offline");
  await reply.fill("still usable");
  await expect(reply).toHaveValue("still usable");
  h.problems.length = 0;

  await back_threads();
  await back_messages();
  await expect(queued(page)).toHaveCount(0, { timeout: 15000 });
  await expect(page.locator(".tb-thread")).toHaveCount(2);
  await expect(page.locator(".tb-msg .text", { hasText: "new while offline" })).toHaveCount(1);
  await page.locator(`.tb-thread-top[data-key="top-${id}"]`).click();
  await expect(thread(page, id).locator(".tb-msg .text")).toHaveText(["first comment", "reply while offline"]);
  h.problems.length = 0;
});

test("a request held forever becomes Not sent after 8 seconds and Send still works", async ({ harness: h }) => {
  test.setTimeout(60000);
  const page = h.page;
  const id = await postComment(page, "#cta", "first comment");
  const box = page.locator(`[data-key="reply-${id}"]`);
  let reached = 0;
  await page.route(posts("/messages"), (route) => {
    reached++;
    if (reached > 1) return route.continue();
  });

  await box.fill("lost in the wind");
  await box.press("Enter");
  await expect.poll(() => reached).toBe(1);
  await expect(thread(page, id).locator(".tb-queued")).toContainText("Sending");
  await expect(thread(page, id).locator(".tb-queued")).toContainText("Not sent", { timeout: 12000 });
  await expect(thread(page, id).locator(".tb-queued")).toContainText("did not answer");

  await box.fill("second try");
  await page.locator(`[data-key="send-${id}"]`).click();
  await expect(thread(page, id).locator(".tb-msg .text")).toContainText(["first comment", "second try"]);
  h.problems.length = 0;
});

type Rect = { top: number; bottom: number; left: number; right: number; height: number };
const rect = (target: Locator): Promise<Rect> => target.evaluate((el) => el.getBoundingClientRect().toJSON());

for (const [width, height] of [[1280, 800], [320, 640]]) {
  test(`queue items never squeeze the list or hide their buttons at ${width}x${height}`, async ({ harness: h }) => {
    const page = h.page;
    await page.setViewportSize({ width, height });
    const id = await postComment(page, "#cta", "first comment");
    const refuse = (route: Route) =>
      route.request().method() === "POST"
        ? route.fulfill({ status: 400, contentType: "application/json", body: '{"error":"invalid","message":"not accepted"}' })
        : route.continue();
    await page.route(posts("/threads"), refuse);
    await page.route(posts("/messages"), refuse);

    await openComposer(page, "#l4");
    await composer(page).fill("x".repeat(150 * 1024));
    await composer(page).press("Enter");
    await openComposer(page, "#l2");
    await composer(page).fill("second refused comment");
    await composer(page).press("Enter");
    await expect(page.locator(".tb-banner")).toBeVisible();
    await expect(page.locator(".tb-queued .tb-btn")).toHaveCount(4);
    const squeezed = await rect(page.locator(".tb-list"));
    expect(squeezed.height, "list height with two queued comments").toBeGreaterThanOrEqual(120);
    expect((await rect(page.locator(".tb-queued").first())).height, "long comment item").toBeLessThan(160);

    await page.locator(`.tb-thread-top[data-key="top-${id}"]`).click();
    await page.locator(`[data-key="reply-${id}"]`).fill("a refused reply");
    await page.locator(`[data-key="reply-${id}"]`).press("Enter");
    const buttons = page.locator(".tb-queued .tb-btn");
    await expect(buttons).toHaveCount(6);

    const panel = await rect(page.locator(".tb-panel"));
    const list = await rect(page.locator(".tb-list"));
    expect(list.height).toBeGreaterThanOrEqual(120);
    expect(panel.bottom).toBeLessThanOrEqual(height);

    // reach every button with the real mouse wheel, top to bottom
    await page.mouse.move((list.left + list.right) / 2, (list.top + list.bottom) / 2);
    await page.mouse.wheel(0, -100000);
    for (let i = 0; i < 6; i++) {
      for (let tries = 0; tries < 60; tries++) {
        const r = await rect(buttons.nth(i));
        if (r.top >= list.top && r.bottom <= list.bottom) break;
        await page.mouse.wheel(0, 80);
        await page.waitForTimeout(30);
      }
      const r = await rect(buttons.nth(i));
      expect(r.top, `button ${i} top`).toBeGreaterThanOrEqual(list.top);
      expect(r.bottom, `button ${i} bottom`).toBeLessThanOrEqual(list.bottom);
    }
    h.problems.length = 0;
  });
}
