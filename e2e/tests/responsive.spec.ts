import type { Page } from "@playwright/test";
import { brand } from "../../packages/shared/src/brand.ts";
import { test, expect } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";
import { chip, closePanel, discardedThread, fakeNotifications, openPanel, postComment, setMode, shot, thread } from "../fixtures/states.ts";

const HEIGHT = 800;
const LONG_WORD = "x".repeat(200);

/** Measures the panel and the pill. Returns one sentence per problem; an empty list means all is well. */
function measure(page: Page): Promise<string[]> {
  return page.evaluate((hostId) => {
    const root = document.getElementById(hostId)!.shadowRoot!;
    const problems: string[] = [];
    const wide = window.innerWidth;
    const high = window.innerHeight;
    const inside = (r: DOMRect) => r.left >= 0 && r.top >= 0 && r.right <= wide && r.bottom <= high;
    const show = (r: DOMRect) => `${Math.round(r.left)},${Math.round(r.top)} to ${Math.round(r.right)},${Math.round(r.bottom)}`;

    const pill = root.querySelector(".tb-modes") as HTMLElement;
    const pillBox = pill.getBoundingClientRect();
    if (!inside(pillBox)) problems.push(`pill outside the viewport (${show(pillBox)})`);
    // The fixture page has a 600 px box of its own, so the page can be wider than a phone without the overlay.
    // The overlay is judged by the width it adds: the page width with the overlay shown against hidden.
    const host = document.getElementById(hostId)!;
    const withOverlay = document.documentElement.scrollWidth;
    host.style.setProperty("display", "none", "important");
    const withoutOverlay = document.documentElement.scrollWidth;
    host.style.removeProperty("display");
    if (withOverlay > Math.max(wide, withoutOverlay)) problems.push(`the overlay makes the page scroll sideways (${withOverlay} > ${Math.max(wide, withoutOverlay)})`);

    const panel = root.querySelector(".tb-panel") as HTMLElement;
    if (panel.hasAttribute("hidden")) return problems;
    const box = panel.getBoundingClientRect();
    if (!inside(box)) problems.push(`panel outside the viewport (${show(box)})`);
    if (panel.scrollWidth > panel.clientWidth) problems.push(`panel content wider than the panel (${panel.scrollWidth} > ${panel.clientWidth})`);
    const limit = parseFloat(getComputedStyle(panel).maxHeight);
    if (box.height > limit + 0.5) problems.push(`panel taller than its max-height (${box.height} > ${limit})`);
    const list = root.querySelector(".tb-list") as HTMLElement | null;
    if (list && list.scrollHeight > list.clientHeight && !["auto", "scroll"].includes(getComputedStyle(list).overflowY)) {
      problems.push("the thread list does not scroll inside the panel");
    }
    for (const button of pill.querySelectorAll("button")) {
      const b = button.getBoundingClientRect();
      const covered = b.left < box.right && b.right > box.left && b.top < box.bottom && b.bottom > box.top;
      if (covered) problems.push(`panel covers the ${button.getAttribute("aria-label")} button`);
    }
    return problems;
  }, brand.hostId);
}

const check = async (page: Page, step: string) => {
  const found = await measure(page);
  expect(found, step).toEqual([]);
};

const dragHeadTo = async (page: Page, x: number, y: number) => {
  const head = (await page.locator(".tb-title").boundingBox())!;
  await page.mouse.move(head.x + 30, head.y + head.height / 2);
  await page.mouse.down();
  await page.mouse.move(x, y, { steps: 6 });
  await page.mouse.up();
};

/** Builds the threads the toggles need while the window is still wide, so clicks are never covered. */
async function prepare(h: Harness): Promise<void> {
  const page = h.page;
  await page.setViewportSize({ width: 1280, height: HEIGHT });
  await discardedThread(h);
  const resolved = await postComment(page, "#l2", "this one is finished");
  await thread(page, resolved).locator(`[data-key="resolve-${resolved}"]`).click();
  await postComment(page, "#cta", LONG_WORD);
  await closePanel(page);
}

async function allToggles(h: Harness, width: number): Promise<void> {
  const page = h.page;
  await prepare(h);
  await page.setViewportSize({ width, height: HEIGHT });
  await check(page, "after resize");

  for (const mode of ["hidden", "view", "comment"] as const) {
    await setMode(page, mode);
    await check(page, `mode ${mode}`);
  }
  await setMode(page, "view");

  await openPanel(page);
  await check(page, "panel open");
  await closePanel(page);
  await check(page, "panel closed");
  await openPanel(page);

  for (const tab of ["resolved", "open"]) {
    await page.locator(`[data-key="tab-${tab}"]`).click();
    await check(page, `${tab} tab`);
  }

  // the newest thread holds the 200-character word
  const longOne = page.locator(".tb-thread", { hasText: LONG_WORD.slice(0, 20) }).first();
  if (!(await longOne.getAttribute("class"))?.includes("active")) await longOne.locator(".tb-thread-top").click();
  await expect(page.locator(".tb-thread.active .tb-msg .text", { hasText: LONG_WORD })).toBeVisible();
  await check(page, "thread expanded");

  await closePanel(page);
  await setMode(page, "comment");
  await page.hover("#cta");
  await page.click("#cta");
  await expect(page.locator('[data-key="send"]')).toBeVisible();
  await check(page, "composer open");
  await page.locator('[data-key="cancel"]').click();
  await setMode(page, "view");
  await openPanel(page);

  const claimed = /THREAD (\S+)/.exec((await h.agent(["next"])).stdout)![1]!;
  await expect(chip(page, claimed)).toHaveText("received", { timeout: 4000 });
  const claimedRow = thread(page, claimed);
  if (!(await claimedRow.getAttribute("class"))?.includes("active")) await claimedRow.locator(".tb-thread-top").click();
  await claimedRow.locator(".tb-restore button").first().click();
  await expect(page.locator(".tb-confirm")).toBeVisible();
  await check(page, "restore confirm shown");
  await page.locator(".tb-confirm [data-keep]").click();

  for (const permission of ["default", "denied"] as const) {
    await fakeNotifications(page, permission);
    await openPanel(page);
    await expect(page.locator(permission === "denied" ? ".tb-banner.blocked" : ".tb-banner")).toBeVisible();
    await check(page, `permission banner ${permission}`);
  }

  await page.locator('[data-key="history"]').click();
  await page.locator(".tb-thread-top").first().click();
  await check(page, "history view");
  await page.locator('[data-key="back"]').click();

  await dragHeadTo(page, -500, -500);
  await check(page, "dragged to the top left");
  await shot(page, `responsive_${width}_top_left`);
  const top = (await page.locator(".tb-panel").boundingBox())!;
  expect(top.x).toBe(0);
  expect(top.y).toBe(0);
  await page.mouse.move(top.x + 30, top.y + 15);
  await page.mouse.down();
  await page.mouse.move(width + 500, HEIGHT + 500, { steps: 6 });
  await page.mouse.up();
  await check(page, "dragged to the bottom right");
  await shot(page, `responsive_${width}_bottom_right`);

  await page.emulateMedia({ colorScheme: "dark" });
  await check(page, "dark colours");
  await shot(page, `responsive_${width}_dark`);
  await page.emulateMedia({ colorScheme: "light" });
  await check(page, "light colours");
  await shot(page, `responsive_${width}`);
}

for (const width of [320, 390, 1280]) {
  test(`responsive at ${width}`, async ({ harness: h }) => {
    await allToggles(h, width);
  });
}

test("resize from 1280 to 320 clamps a dragged panel back inside", async ({ harness: h }) => {
  const page = h.page;
  await postComment(page, "#cta", "drag me");
  await openPanel(page);
  await check(page, "at 1280");

  await dragHeadTo(page, -500, -500);
  const corner = (await page.locator(".tb-panel").boundingBox())!;
  await page.mouse.move(corner.x + 30, corner.y + 15);
  await page.mouse.down();
  await page.mouse.move(1500, 1000, { steps: 6 });
  await page.mouse.up();
  await check(page, "dragged to the bottom right at 1280");
  const dragged = (await page.locator(".tb-panel").boundingBox())!;
  expect(dragged.x + dragged.width).toBeGreaterThan(1200);

  await page.setViewportSize({ width: 320, height: HEIGHT });
  await expect.poll(() => measure(page)).toEqual([]);
  const small = (await page.locator(".tb-panel").boundingBox())!;
  const pill = (await page.locator(".tb-modes").boundingBox())!;
  expect(small.x).toBeGreaterThanOrEqual(0);
  expect(small.x + small.width).toBeLessThanOrEqual(320);
  expect(small.y + small.height).toBeLessThanOrEqual(pill.y);
  await shot(page, "responsive_dragged_then_320");
});

test("responsive check fails when the panel is forced to 400px wide at 320", async ({ harness: h }) => {
  const page = h.page;
  await postComment(page, "#cta", "too wide");
  await openPanel(page);
  await page.setViewportSize({ width: 320, height: HEIGHT });
  await check(page, "before the break");

  await page.evaluate((hostId) => {
    const style = document.createElement("style");
    style.id = "force-wide";
    style.textContent = ".tb-panel{width:400px!important}";
    document.getElementById(hostId)!.shadowRoot!.append(style);
  }, brand.hostId);
  const found = await measure(page);
  expect(found.length).toBeGreaterThan(0);
  expect(found.join("\n")).toContain("panel outside the viewport");

  await page.evaluate((hostId) => document.getElementById(hostId)!.shadowRoot!.getElementById("force-wide")!.remove(), brand.hostId);
  await check(page, "after the break is removed");
});
