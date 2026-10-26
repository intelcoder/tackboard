import type { Page } from "@playwright/test";
import { brand } from "../../packages/shared/src/brand.ts";
import { test, expect } from "../fixtures/harness.ts";
import { openPanel, postComment } from "../fixtures/states.ts";

type Seen = { notes: { title: string; body: string }[]; asked: number };

/** Replaces window.Notification with a recorder that starts at the given permission, then reloads. */
async function fakeNotifications(page: Page, permission: "granted" | "default" | "denied"): Promise<void> {
  await page.addInitScript((start) => {
    const w = window as any;
    w.__seen = { notes: [], asked: 0 };
    w.Notification = class {
      static permission = start;
      static requestPermission() {
        w.__seen.asked++;
        (w.Notification as any).permission = "granted";
        return Promise.resolve("granted");
      }
      constructor(title: string, o?: { body?: string }) {
        w.__seen.notes.push({ title, body: o?.body ?? "" });
      }
    };
  }, permission);
  await page.reload();
  await page.locator(`#${brand.hostId}`).waitFor({ state: "attached" });
}

const seen = (page: Page): Promise<Seen> => page.evaluate(() => (window as any).__seen);

test("notifications", async ({ harness: h }) => {
  const page = h.page;

  // granted: one agent reply makes exactly one notification that names the agent
  await fakeNotifications(page, "granted");
  const id = await postComment(page, "#cta", "notify me");
  expect((await h.agent(["next"])).code).toBe(0);
  await expect(page.locator(".tb-chip")).toHaveText("received", { timeout: 3000 });
  expect((await seen(page)).notes).toEqual([]);
  expect((await h.agent(["reply", id, "on it"])).code).toBe(0);
  await expect.poll(async () => (await seen(page)).notes.length, { timeout: 4000 }).toBe(1);
  await page.waitForTimeout(3200);
  const granted = await seen(page);
  expect(granted.notes).toHaveLength(1);
  expect(granted.notes[0]!.title).toContain("claude-main");
  expect(granted.notes[0]!.body).toBe("on it");
  await expect(page.locator(".tb-banner")).toHaveCount(0);

  // default: the banner shows, Allow calls requestPermission
  await fakeNotifications(page, "default");
  await openPanel(page);
  const banner = page.locator(".tb-banner");
  await expect(banner).toContainText("Get a notification when an agent replies.");
  await banner.getByRole("button", { name: "Allow" }).click();
  await expect.poll(async () => (await seen(page)).asked).toBe(1);
  await expect(page.locator(".tb-banner")).toHaveCount(0);

  // default again: Not now leaves the small link, and it survives a reload
  await page.evaluate(() => localStorage.clear());
  await fakeNotifications(page, "default");
  await openPanel(page);
  await page.locator(".tb-banner").getByRole("button", { name: "Not now" }).click();
  const link = page.locator(".tb-banner.small");
  await expect(link).toHaveText("Turn on notifications");
  expect((await seen(page)).asked).toBe(0);
  await page.reload();
  await page.locator(`#${brand.hostId}`).waitFor({ state: "attached" });
  await openPanel(page);
  await expect(page.locator(".tb-banner.small")).toHaveText("Turn on notifications");
  await expect(page.locator(".tb-banner", { hasText: "Get a notification" })).toHaveCount(0);

  // denied: the blocked banner and the site-settings hint
  await fakeNotifications(page, "denied");
  await openPanel(page);
  const blocked = page.locator(".tb-banner.blocked");
  await expect(blocked).toContainText("Notifications are blocked");
  await expect(blocked).toContainText("site settings");
  await expect(page.getByRole("button", { name: "Allow" })).toHaveCount(0);
});
