import type { Page } from "@playwright/test";
import { brand } from "../../packages/shared/src/brand.ts";
import { test, expect } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";
import { closePanel, fakeNotifications, modeButton, openPanel, outline, postComment, setMode } from "../fixtures/states.ts";

const composer = (page: Page) => page.locator('[data-key="composer"]');
const drafts = (page: Page) => page.locator('[data-key="drafts"]');
const draftRows = (page: Page) => drafts(page).locator(".tb-queued");
const addDraftButton = (page: Page) => page.locator('[data-key="draft"]');
const draftBadge = (page: Page) => page.locator(".tb-modes .draft-count");
const sendAll = (page: Page) => page.locator('[data-key="send-all"]');

/** Counts the requests that create a comment, so a test can say nothing was sent. */
function countPosts(h: Harness): () => number {
  let posts = 0;
  h.page.on("request", (r) => {
    if (r.method() === "POST" && new URL(r.url()).pathname === "/threads") posts++;
  });
  return () => posts;
}

/** The real flow up to the box: comment mode, hover, click. */
async function pick(page: Page, selector: string) {
  await setMode(page, "comment");
  await page.hover(selector);
  await outline(page).waitFor();
  await page.click(selector);
  await composer(page).waitFor();
}

async function addDraft(page: Page, selector: string, text: string) {
  await pick(page, selector);
  await composer(page).fill(text);
  await addDraftButton(page).click();
  await expect(composer(page)).toHaveCount(0);
}

/** What the daemon holds, oldest first, as `tackboard status` shows it. */
async function selectorsInDaemon(h: Harness): Promise<string[]> {
  const { stdout } = await h.agent(["status"]);
  return stdout.split("\n").filter((line) => line.startsWith("#")).map((line) => line.trim().split(/\s+/).pop()!);
}

test("drafts reach the daemon only on Send all, and then arrive in order", async ({ harness: h }) => {
  const page = h.page;
  const posts = countPosts(h);
  let alerts = 0;
  page.on("dialog", (d) => {
    alerts++;
    void d.dismiss();
  });

  await addDraft(page, "#cta", "first draft");
  await expect(page.locator(".tb-toast")).toHaveText("Draft added (1)");
  // still in comment mode, so the next element can be picked at once
  await expect(modeButton(page, "comment")).toHaveAttribute("aria-pressed", "true");
  await addDraft(page, "#l4", "<img src=x onerror=alert(1)>");
  await addDraft(page, "#far", "third draft");
  await expect(page.locator(".tb-toast")).toHaveText("Draft added (3)");

  await expect(drafts(page).locator(".tb-section")).toContainText("Drafts (3)");
  await expect(draftRows(page)).toHaveCount(3);
  await expect(draftRows(page).locator(".tb-target")).toHaveText(["button#cta", "div#l4", "h2#far"]);
  await expect(draftRows(page).locator(".text")).toHaveText(["first draft", "<img src=x onerror=alert(1)>", "third draft"]);
  expect(await drafts(page).locator("img").count()).toBe(0);
  expect(alerts).toBe(0);
  await expect(sendAll(page)).toHaveText("Send all (3)");
  await expect(draftBadge(page)).toHaveText("3");

  // nothing has been sent
  expect(posts()).toBe(0);
  expect((await h.agent(["status"])).stdout).toContain("no threads");
  expect((await h.agent(["next"])).stdout).not.toContain("THREAD");

  // drafts survive closing the panel and switching mode
  await closePanel(page);
  await setMode(page, "view");
  await openPanel(page);
  await expect(draftRows(page)).toHaveCount(3);

  // a row's element label scrolls the page to the element
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await draftRows(page).nth(2).locator(".tb-target").click();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);

  // Remove drops one draft
  await draftRows(page).nth(1).locator('[data-key="remove-draft"]').click();
  await expect(draftRows(page)).toHaveCount(2);
  await expect(drafts(page).locator(".tb-section")).toContainText("Drafts (2)");
  await expect(sendAll(page)).toHaveText("Send all (2)");
  await expect(draftBadge(page)).toHaveText("2");

  await sendAll(page).click();
  await expect(drafts(page)).toHaveCount(0);
  await expect(draftBadge(page)).toBeHidden();
  await expect(page.locator(".tb-thread")).toHaveCount(2);
  await expect(page.locator(".tb-queued")).toHaveCount(0, { timeout: 15000 });
  await expect(page.locator(".tb-thread .tb-chip")).toHaveText(["pending", "pending"]);
  expect(await selectorsInDaemon(h)).toEqual(["#cta", "#far"]);
  expect(posts()).toBe(2);
  expect(alerts).toBe(0);
});

test("with the daemon down, Send all queues the drafts and they arrive once and in order", async ({ harness: h }) => {
  const page = h.page;
  await addDraft(page, "#cta", "one");
  await addDraft(page, "#l4", "two");

  const refuse = (route: import("@playwright/test").Route) =>
    route.request().method() === "POST" ? route.abort("connectionrefused") : route.continue();
  const isThreads = (url: URL) => url.pathname === "/threads";
  await page.route(isThreads, refuse);
  await sendAll(page).click();
  await expect(drafts(page)).toHaveCount(0);
  const waiting = page.locator(".tb-queue .tb-queued");
  await expect(waiting).toHaveCount(2);
  await expect(waiting.locator(".tb-target")).toHaveText(["button#cta", "div#l4"]);
  await expect(waiting.first()).toContainText("Waiting to retry");
  h.problems.length = 0;

  await page.unroute(isThreads, refuse);
  await expect(waiting).toHaveCount(0, { timeout: 15000 });
  expect(await selectorsInDaemon(h)).toEqual(["#cta", "#l4"]);
  h.problems.length = 0;
});

test("Enter adds a draft; Send now and Ctrl or Cmd plus Enter send at once; reply Enter is unchanged", async ({ harness: h }) => {
  const page = h.page;
  const posts = countPosts(h);

  await pick(page, "#cta");
  await composer(page).fill("line one");
  await composer(page).press("Shift+Enter");
  await composer(page).pressSequentially("line two");
  await expect(composer(page)).toHaveValue("line one\nline two");
  await composer(page).press("Enter");
  await expect(composer(page)).toHaveCount(0);
  await expect(draftRows(page)).toHaveCount(1);
  await expect(draftBadge(page)).toHaveText("1");
  await page.waitForTimeout(300);
  expect(posts()).toBe(0);

  await pick(page, "#l4");
  await composer(page).fill("sent now");
  await page.locator('[data-key="send"]').click();
  await expect(page.locator(".tb-thread.active .tb-msg .text")).toHaveText("sent now");
  expect(posts()).toBe(1);
  await expect(draftRows(page)).toHaveCount(1);

  for (const [i, key] of ["Control+Enter", "Meta+Enter"].entries()) {
    await pick(page, "#l2");
    await composer(page).fill(`sent with ${key}`);
    await composer(page).press(key);
    await expect(page.locator(".tb-thread")).toHaveCount(i + 2);
    expect(posts()).toBe(i + 2);
  }
  await expect(draftRows(page)).toHaveCount(1);

  // the reply box still sends on Enter
  const id = (await page.locator(".tb-thread").first().getAttribute("data-id"))!;
  await page.locator(`.tb-thread-top[data-key="top-${id}"]`).click();
  await page.locator(`[data-key="reply-${id}"]`).fill("a reply");
  await page.locator(`[data-key="reply-${id}"]`).press("Enter");
  await expect(page.locator(".tb-msg .text", { hasText: "a reply" })).toHaveCount(1);
  await expect(draftRows(page)).toHaveCount(1);

  // an empty box adds nothing; Cancel adds nothing
  await pick(page, "#l3");
  await composer(page).fill("   ");
  await addDraftButton(page).click();
  await composer(page).press("Enter");
  await expect(composer(page)).toHaveCount(1);
  await composer(page).fill("changed my mind");
  await page.locator('[data-key="cancel"]').click();
  await expect(composer(page)).toHaveCount(0);
  await expect(draftRows(page)).toHaveCount(1);
  await expect(draftBadge(page)).toHaveText("1");
});

test("each draft keeps the window size and page address from when it was added", async ({ harness: h }) => {
  const page = h.page;
  const now = () => page.evaluate(() => ({ viewport: { w: window.innerWidth, h: window.innerHeight }, url: location.href }));
  const token = await page.evaluate((name) => (globalThis as any)[name].token as string, brand.configGlobal);

  await page.setViewportSize({ width: 1280, height: 800 });
  await addDraft(page, "#cta", "first");
  const first = await now();
  await page.setViewportSize({ width: 900, height: 600 });
  await page.evaluate(() => history.pushState({}, "", "/second?x=1"));
  await addDraft(page, "#l4", "second");
  const second = await now();
  expect(second).not.toEqual(first);
  await page.setViewportSize({ width: 700, height: 500 });
  await page.evaluate(() => history.pushState({}, "", "/third"));
  await sendAll(page).click();
  await expect(draftRows(page)).toHaveCount(0);
  await expect(page.locator(".tb-queued")).toHaveCount(0, { timeout: 15000 });

  const body = (await (await fetch(`${h.daemonUrl}/threads`, { headers: { [brand.tokenHeader]: token } })).json()) as {
    threads: { n: number; url: string; viewport: { w: number; h: number } }[];
  };
  const sent = body.threads.sort((x, y) => x.n - y.n).map((t) => ({ viewport: t.viewport, url: t.url }));
  expect(sent).toEqual([first, second]);
});

test("drafts stay when the tab changes", async ({ harness: h }) => {
  const page = h.page;
  await postComment(page, "#l2", "a thread so the tabs show");
  await addDraft(page, "#cta", "kept");
  await expect(draftRows(page)).toHaveCount(1);
  await page.locator('[data-key="tab-resolved"]').click();
  await page.locator('[data-key="tab-open"]').click();
  await expect(draftRows(page)).toHaveCount(1);
  await expect(draftRows(page).locator(".text")).toHaveText("kept");
});

for (const size of [{ width: 1280, height: 800 }, { width: 320, height: 640 }]) {
  test(`the drafts block keeps the list and its buttons inside the panel at ${size.width}x${size.height}`, async ({ harness: h }) => {
    const page = h.page;
    await page.setViewportSize({ width: 1280, height: 800 });
    await fakeNotifications(page, "default");
    for (const [selector, text] of [["#cta", "a long one. ".repeat(20)], ["#l2", "b".repeat(150)], ["#l3", "third"], ["#l4", "fourth"], ["#far", "fifth"]] as const) {
      await addDraft(page, selector, text);
    }
    await page.setViewportSize(size);
    await expect(page.locator(".tb-banner")).toBeVisible();
    await expect(draftRows(page)).toHaveCount(5);

    const inside = async (selector: string, within: string) => {
      const box = (await page.locator(selector).boundingBox())!;
      const frame = (await page.locator(within).boundingBox())!;
      return box.x >= frame.x && box.y >= frame.y - 0.5 && box.x + box.width <= frame.x + frame.width + 0.5 && box.y + box.height <= frame.y + frame.height + 0.5;
    };
    const list = (await page.locator(".tb-list").boundingBox())!;
    expect(list.height).toBeGreaterThanOrEqual(120);
    expect(await inside('[data-key="send-all"]', ".tb-panel")).toBe(true);
    expect(await inside('[data-key="send-all"]', ".tb-list")).toBe(true);

    // the rest is reached by scrolling inside the list, with the real wheel
    await page.mouse.move(list.x + list.width / 2, list.y + list.height / 2);
    const last = '[data-key="drafts"] .tb-queued:last-child [data-key="remove-draft"]';
    for (let tries = 0; tries < 20 && !(await inside(last, ".tb-list")); tries++) await page.mouse.wheel(0, 150);
    expect(await inside(last, ".tb-list")).toBe(true);
    expect(await inside(last, ".tb-panel")).toBe(true);
    const after = (await page.locator(".tb-list").boundingBox())!;
    expect(after.height).toBeGreaterThanOrEqual(120);
  });
}

for (const size of [{ width: 1280, height: 800 }, { width: 320, height: 640 }]) {
  test(`the new comment box keeps the chip, the agent and the ✕ above the box and two buttons below it at ${size.width}px`, async ({ harness: h }) => {
    const page = h.page;
    const posts = countPosts(h);
    await page.setViewportSize(size);
    await pick(page, "#cta");

    const rect = async (selector: string) => page.locator(selector).first().evaluate((e) => {
      const r = e.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
    });
    const box = await rect('[data-key="composer"]');
    const chip = await rect(".tb-composer .target");
    const agent = await rect(".tb-composer .tb-hint");
    const cross = await rect('.tb-composer [data-key="cancel"]');
    const sendNow = await rect('.tb-composer [data-key="send"]');
    const addDraftBox = await rect('.tb-composer [data-key="draft"]');
    const panel = await rect(".tb-panel");

    await expect(page.locator(".tb-composer .tb-hint")).toHaveText(/^to \S/);
    for (const above of [chip, agent, cross]) expect(above.bottom).toBeLessThanOrEqual(box.top + 0.5);
    // one top row: chip on the left, then the agent text, then the ✕ at the right end
    expect(Math.abs(chip.top - cross.top)).toBeLessThan(12);
    expect(Math.abs((chip.top + chip.bottom) / 2 - (cross.top + cross.bottom) / 2)).toBeLessThan(1);
    expect(chip.right).toBeLessThanOrEqual(agent.left + 0.5);
    expect(agent.right).toBeLessThanOrEqual(cross.left + 0.5);
    expect(cross.right).toBeGreaterThan(panel.right - 20);
    // the ✕ is a small plain icon button with a name and a tooltip, not a text button
    expect(cross.width).toBeCloseTo(24, 0);
    expect(cross.height).toBeCloseTo(24, 0);
    await expect(page.locator('[data-key="cancel"]')).toHaveAttribute("aria-label", "Cancel");
    await expect(page.locator('[data-key="cancel"]')).toHaveAttribute("title", "Cancel");
    await expect(page.locator('[data-key="cancel"]')).toHaveText("✕");
    await expect(page.locator(".tb-composer button", { hasText: "Cancel" })).toHaveCount(0);

    // the action row holds only Send now and Add draft: below the box, on one line, right-aligned
    await expect(page.locator(".tb-composer button")).toHaveCount(3);
    expect(sendNow.top).toBeGreaterThanOrEqual(box.bottom - 0.5);
    expect(addDraftBox.top).toBeGreaterThanOrEqual(box.bottom - 0.5);
    expect(Math.abs(sendNow.top - addDraftBox.top)).toBeLessThan(2);
    expect(sendNow.right).toBeLessThanOrEqual(addDraftBox.left + 0.5);
    expect(Math.abs(addDraftBox.right - box.right)).toBeLessThan(2);

    // the ✕ closes the box and adds nothing
    await composer(page).fill("not kept");
    await page.locator('[data-key="cancel"]').click();
    await expect(composer(page)).toHaveCount(0);
    await expect(draftRows(page)).toHaveCount(0);
    await expect(draftBadge(page)).toBeHidden();
    expect(posts()).toBe(0);

    // nothing else about sending changed: Enter adds a draft, Send now sends
    await pick(page, "#cta");
    await composer(page).fill("kept as a draft");
    await composer(page).press("Enter");
    await expect(draftRows(page)).toHaveCount(1);
    expect(posts()).toBe(0);
    await pick(page, "#l2");
    await composer(page).fill("sent now");
    await page.locator('[data-key="send"]').click();
    await expect(page.locator(".tb-thread")).toHaveCount(1);
    expect(posts()).toBe(1);
  });

  test(`a draft row has the label and Remove on one line, plain text, and a bold title at ${size.width}px`, async ({ harness: h }) => {
    const page = h.page;
    await page.setViewportSize(size);
    await addDraft(page, "#cta", "Make this button blue and bigger.");
    const row = draftRows(page).first();
    const label = (await row.locator(".tb-target").boundingBox())!;
    const remove = (await row.locator('[data-key="remove-draft"]').boundingBox())!;
    const text = (await row.locator(".text").boundingBox())!;
    expect(label.y + label.height / 2).toBeGreaterThan(remove.y);
    expect(label.y + label.height / 2).toBeLessThan(remove.y + remove.height);
    expect(label.x + label.width).toBeLessThanOrEqual(remove.x + 0.5);
    expect(text.y).toBeGreaterThanOrEqual(Math.max(label.y + label.height, remove.y + remove.height) - 0.5);
    expect(await row.locator(".text").evaluate((e) => getComputedStyle(e).opacity)).toBe("1");
    const title = drafts(page).locator(".tb-drafts-title");
    await expect(title).toHaveText("Drafts (1)");
    expect(Number(await title.evaluate((e) => getComputedStyle(e).fontWeight))).toBeGreaterThanOrEqual(600);
  });
}
