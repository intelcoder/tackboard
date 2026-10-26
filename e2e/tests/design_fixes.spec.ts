import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { brand } from "../../packages/shared/src/brand.ts";
import { test, expect } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";
import { chip, discardedThread, fakeNotifications, openPanel, postComment, shot, thread } from "../fixtures/states.ts";

type Box = { x: number; y: number; width: number; height: number };

const sizes = [
  { name: "1280", width: 1280, height: 800 },
  { name: "390", width: 390, height: 844 },
  { name: "320", width: 320, height: 640 },
];

async function box(page: Page, selector: string): Promise<Box> {
  const b = await page.locator(selector).first().boundingBox();
  if (!b) throw new Error(`${selector} has no box`);
  return b;
}

function inside(inner: Box, outer: Box): boolean {
  return inner.x >= outer.x - 1 && inner.y >= outer.y - 1 && inner.x + inner.width <= outer.x + outer.width + 1 && inner.y + inner.height <= outer.y + outer.height + 1;
}

/** A thread with many long messages. The agent edits a file before each reply, so every reply has a restore point. */
async function longThread(h: Harness, finish: boolean): Promise<string> {
  const id = await postComment(h.page, "#cta", "a long thread to rewind");
  await h.agent(["next"]);
  await expect(chip(h.page, id)).toHaveText("received", { timeout: 4000 });
  for (let i = 1; i <= 6; i++) {
    writeFileSync(join(h.repo, `edit-${i}.txt`), `edit ${i}\n`);
    await h.agent(["reply", id, `reply number ${i}: this answer is long enough to take a few lines inside the narrow panel`]);
  }
  if (finish) {
    await h.agent(["resolve", id]);
    await h.page.locator('[data-key="tab-resolved"]').click();
    await expect(chip(h.page, id)).toHaveText("resolved", { timeout: 6000 });
    const row = thread(h.page, id);
    if (!(await row.getAttribute("class"))?.includes("active")) await row.locator(`[data-key="top-${id}"]`).first().click();
  }
  await expect(thread(h.page, id).locator(".tb-restore button").last()).toBeVisible({ timeout: 6000 });
  return id;
}

for (const blocked of [false, true]) {
  for (const size of sizes) {
    test(`restore confirm is fully visible on open (${blocked ? "blocked" : "enabled"}, ${size.name})`, async ({ harness: h }) => {
      const page = h.page;
      await page.setViewportSize({ width: size.width, height: size.height });
      const id = await longThread(h, !blocked);
      // Scroll a middle restore button to the bottom edge of the list, so the confirm opens below the fold.
      const open = thread(page, id).locator(".tb-restore button").nth(2);
      await open.evaluate((el) => {
        const list = el.closest(".tb-list")!;
        list.scrollTop += el.getBoundingClientRect().bottom - list.getBoundingClientRect().bottom;
      });
      // A script click, so the test does not scroll the button into view for us.
      await open.evaluate((el: HTMLElement) => el.click());
      const confirm = page.locator(".tb-confirm");
      await expect(confirm).toBeVisible();
      if (blocked) await expect(confirm.locator(".tb-btn.danger")).toBeDisabled();
      else await expect(confirm.locator(".tb-btn.danger")).toBeEnabled();
      if (blocked) await expect(confirm.locator(".tb-reason")).toBeVisible();
      await page.waitForTimeout(300);

      const list = await box(page, ".tb-list");
      const view = { x: 0, y: 0, width: size.width, height: size.height };
      for (const part of [".tb-confirm-title", ".tb-reason", ".tb-confirm [data-keep]", ".tb-confirm .tb-btn.danger"]) {
        if (part === ".tb-reason" && !blocked) continue;
        const rect = await box(page, part);
        expect(inside(rect, list), `${part} inside the list's visible area: ${JSON.stringify(rect)} list ${JSON.stringify(list)}`).toBe(true);
        expect(inside(rect, view), `${part} inside the viewport`).toBe(true);
      }
      if (blocked) {
        const reason = await box(page, ".tb-reason");
        const keep = await box(page, ".tb-confirm [data-keep]");
        expect(reason.y + reason.height, "the reason sits above the buttons").toBeLessThanOrEqual(keep.y + 1);
      }
      await shot(page, `design-restore-confirm-${blocked ? "blocked" : "enabled"}-${size.name}`);
    });
  }
}

for (const size of sizes) {
  test(`restore marker is a single line (${size.name})`, async ({ harness: h }) => {
    const page = h.page;
    await page.setViewportSize({ width: size.width, height: size.height });
    const id = await longThread(h, false);
    await thread(page, id).locator(".tb-restore").last().scrollIntoViewIfNeeded();
    // One call reads everything, so a redraw of the panel cannot swap the element between reads.
    const seen = await page.evaluate((hostId) => {
      const root = document.getElementById(hostId)!.shadowRoot!;
      const rows = root.querySelectorAll(".tb-restore");
      const row = rows[rows.length - 1]!;
      const label = row.querySelector("span")!;
      const button = row.querySelector("button")!;
      const rect = (el: Element) => el.getBoundingClientRect().toJSON() as Box;
      return { row: rect(row), label: rect(label), button: rect(button), fontSize: parseFloat(getComputedStyle(label).fontSize) };
    }, brand.hostId);
    expect(seen.label.height, "label is one text line").toBeLessThan(seen.fontSize * 1.6);
    expect(seen.button.height, "button text is one line").toBeLessThan(seen.fontSize * 2.6);
    expect(seen.row.height, "the whole row is one line").toBeLessThan(seen.fontSize * 3.2);
    expect(inside(seen.button, seen.row)).toBe(true);
    const clipped = await page.evaluate((hostId) => {
      const root = document.getElementById(hostId)!.shadowRoot!;
      const rows = root.querySelectorAll(".tb-restore");
      const label = rows[rows.length - 1]!.querySelector("span")!;
      const walker = document.createTreeWalker(label, NodeFilter.SHOW_TEXT);
      let node = walker.nextNode() as Text;
      while (!/^after message \d+/.test(node.data)) node = walker.nextNode() as Text;
      const owner = node.parentElement!;
      const range = document.createRange();
      range.setStart(node, 0);
      range.setEnd(node, /^after message \d+/.exec(node.data)![0].length);
      return { ownerCut: owner.scrollWidth > owner.clientWidth + 1, right: range.getBoundingClientRect().right, labelRight: label.getBoundingClientRect().right };
    }, brand.hostId);
    expect(clipped.ownerCut, "the words 'after message N' are not truncated with an ellipsis").toBe(false);
    expect(clipped.right, "the words 'after message N' are inside the label").toBeLessThanOrEqual(clipped.labelRight + 0.5);
    await shot(page, `design-marker-${size.name}`);
  });
}

test("the denied banner can be dismissed and stays dismissed after a reload", async ({ harness: h }) => {
  const page = h.page;
  const id = await longThread(h, false);
  await fakeNotifications(page, "denied");
  await openPanel(page);
  await thread(page, id).locator(`[data-key="top-${id}"]`).first().click();
  const banner = page.locator(".tb-banner.blocked");
  await expect(banner).toBeVisible();
  await shot(page, "design-banner-denied-before");
  const bannerHeight = (await banner.boundingBox())!.height;
  const before = (await box(page, ".tb-list")).height;
  await banner.getByRole("button", { name: "Dismiss" }).click();
  await expect(banner).toHaveCount(0);
  const after = (await box(page, ".tb-list")).height;
  expect(after - before, "the thread area gets taller by the banner height").toBeGreaterThan(bannerHeight - 3);
  expect(after - before).toBeLessThan(bannerHeight + 3);
  await shot(page, "design-banner-denied-after");

  await fakeNotifications(page, "denied");
  await openPanel(page);
  await expect(page.locator(".tb-panel")).toBeVisible();
  await expect(page.locator(".tb-banner.blocked")).toHaveCount(0);
});

test("history says the message number, not the internal id", async ({ harness: h }) => {
  const page = h.page;
  const id = await discardedThread(h);
  await expect(thread(page, id).locator(".tb-msg.system").first()).toHaveText(/^Restored to message \d+$/);
  await page.locator('[data-key="history"]').click();
  await page.locator(".tb-thread-top").first().click();
  await expect(page.locator(".tb-msg.system").first()).toHaveText(/^Restored to message \d+$/);
  await shot(page, "design-history-wording");
});

test("an enabled Rewind keeps the amber fill", async ({ harness: h }) => {
  const page = h.page;
  const id = await discardedThread(h);
  await thread(page, id).locator(".tb-restore button").first().click();
  const rewind = page.locator(".tb-confirm .tb-btn.danger");
  await expect(rewind).toBeEnabled();
  const seen = await page.evaluate((hostId) => {
    const root = document.getElementById(hostId)!.shadowRoot!;
    const probe = document.createElement("div");
    probe.style.color = getComputedStyle(root.host).getPropertyValue("--st-waiting").trim();
    root.append(probe);
    const amber = getComputedStyle(probe).color;
    probe.remove();
    const button = root.querySelector(".tb-confirm .tb-btn.danger")!;
    return { amber, fill: getComputedStyle(button).backgroundColor, cursor: getComputedStyle(button).cursor };
  }, brand.hostId);
  expect(seen.fill).toBe(seen.amber);
  expect(seen.cursor).not.toBe("not-allowed");
});

test("a disabled button is grey only for the blocked Rewind", async ({ harness: h }) => {
  const seen = await h.page.evaluate((hostId) => {
    const root = document.getElementById(hostId)!.shadowRoot!;
    const make = (cls: string) => {
      const b = document.createElement("button");
      b.className = cls;
      b.disabled = true;
      root.append(b);
      const cs = getComputedStyle(b);
      const out = { opacity: cs.opacity, fill: cs.backgroundColor };
      b.remove();
      return out;
    };
    const soft = document.createElement("div");
    soft.style.background = getComputedStyle(root.host).getPropertyValue("--tb-soft").trim();
    root.append(soft);
    const grey = getComputedStyle(soft).backgroundColor;
    soft.remove();
    return { plain: make("tb-btn"), primary: make("tb-btn primary"), danger: make("tb-btn danger"), grey };
  }, brand.hostId);
  expect(seen.danger.fill, "blocked Rewind is neutral grey").toBe(seen.grey);
  expect(seen.plain.opacity, "other disabled buttons keep the faded look").toBe("0.45");
  expect(seen.primary.opacity).toBe("0.45");
  expect(seen.primary.fill, "other disabled buttons are not recoloured").not.toBe(seen.grey);
});

test("the denied banner returns when the restore confirm is out of view", async ({ harness: h }) => {
  const page = h.page;
  const id = await longThread(h, true);
  await fakeNotifications(page, "denied");
  await openPanel(page);
  await page.locator('[data-key="tab-resolved"]').click();
  const row = thread(page, id);
  if (!(await row.getAttribute("class"))?.includes("active")) await row.locator(`[data-key="top-${id}"]`).first().click();
  await row.locator(".tb-restore button").last().click();
  await expect(page.locator(".tb-confirm")).toBeVisible();
  await expect(page.locator(".tb-banner.blocked")).toHaveCount(0);
  await page.locator('[data-key="tab-open"]').click();
  await expect(page.locator(".tb-confirm")).toHaveCount(0);
  await expect(page.locator(".tb-banner.blocked")).toBeVisible();
  await shot(page, "design-banner-after-tab-switch");
});
