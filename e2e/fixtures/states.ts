import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { brand } from "../../packages/shared/src/brand.ts";
import type { Harness } from "./harness.ts";

export const artifacts = join(import.meta.dirname, "..", "artifacts");

/** Saves a screenshot to e2e/artifacts/<name>.png. */
export async function shot(page: Page, name: string): Promise<string> {
  mkdirSync(artifacts, { recursive: true });
  const path = join(artifacts, `${name}.png`);
  await page.screenshot({ path });
  return path;
}

export const modeButton = (page: Page, mode: "hidden" | "view" | "comment") => page.locator(`.tb-modes [data-mode="${mode}"]`);
export const panelToggle = (page: Page) => page.locator(".tb-modes [data-panel]");
export const badge = (page: Page) => page.locator(".tb-modes .badge");
export const outline = (page: Page) => page.locator(".tb-outline");
export const crumbs = (page: Page) => page.locator(".tb-crumbs button");

export async function setMode(page: Page, mode: "hidden" | "view" | "comment"): Promise<void> {
  await modeButton(page, mode).click();
}

export async function openPanel(page: Page): Promise<void> {
  if ((await panelToggle(page).getAttribute("aria-pressed")) !== "true") await panelToggle(page).click();
}

export async function closePanel(page: Page): Promise<void> {
  if ((await panelToggle(page).getAttribute("aria-pressed")) === "true") await panelToggle(page).click();
}

/** The real user flow: comment mode, hover, click the element, type, Send. Returns the thread id. */
export async function postComment(page: Page, selector: string, text: string): Promise<string> {
  await setMode(page, "comment");
  await page.hover(selector);
  await outline(page).waitFor();
  await page.click(selector);
  await page.locator('[data-key="composer"]').fill(text);
  await page.locator('[data-key="send"]').click();
  const thread = page.locator(".tb-thread.active");
  await thread.waitFor();
  return (await thread.getAttribute("data-id"))!;
}

export const thread = (page: Page, id: string) => page.locator(`.tb-thread[data-id="${id}"]`);
export const chip = (page: Page, id: string) => thread(page, id).locator(".tb-chip");

// ---- states for the style rows and the responsive checks ----

/** Replaces window.Notification with a recorder at the given permission, then reloads the page. */
export async function fakeNotifications(page: Page, permission: "granted" | "default" | "denied"): Promise<void> {
  await page.addInitScript((start) => {
    const w = window as any;
    w.Notification = class {
      static permission = start;
      static requestPermission() {
        return Promise.resolve(start);
      }
    };
  }, permission);
  await page.reload();
  await page.locator(`#${brand.hostId}`).waitFor({ state: "attached" });
}

/** A thread that the agent has claimed and asked a question on, so it is waiting on the user. */
async function askedThread(h: Harness, text = "make it blue"): Promise<string> {
  const id = await postComment(h.page, "#cta", text);
  await h.agent(["next"]);
  await h.agent(["reply", id, "which blue?", "--ask"]);
  await expect(chip(h.page, id)).toHaveText("waiting on you", { timeout: 4000 });
  return id;
}

/** A thread that was restored to its first message, so its later messages are discarded. The panel stays open on the Resolved tab. */
export async function discardedThread(h: Harness): Promise<string> {
  const page = h.page;
  const id = await postComment(page, "#cta", "change the label");
  await h.agent(["next"]);
  await expect(chip(page, id)).toHaveText("received", { timeout: 4000 });
  await h.agent(["reply", id, "changed the label"]);
  await thread(page, id).locator(`[data-key="resolve-${id}"]`).click();
  await page.locator('[data-key="tab-resolved"]').click();
  await expect(chip(page, id)).toHaveText("resolved", { timeout: 6000 });
  const row = thread(page, id);
  if (!(await row.getAttribute("class"))?.includes("active")) await row.locator(`[data-key="top-${id}"]`).first().click();
  await row.locator(".tb-restore button").first().click();
  const rewind = page.locator(".tb-confirm .tb-btn.danger");
  await expect(rewind).toBeEnabled();
  await rewind.click();
  await expect(page.locator(".tb-confirm")).toHaveCount(0);
  return id;
}

export type StateName =
  | "view" | "commentMode" | "waitingClosed" | "panelOpen" | "waitingOpen" | "hoverCta" | "pendingThread" | "waitingThread"
  | "resolvedThread" | "pulsingPin" | "receivedThread" | "conversation" | "composerOpen" | "restoreConfirm"
  | "notificationsDenied" | "historyView";

/** Each helper reaches a named UI state through the real flow. */
export const reach: Record<StateName, (h: Harness) => Promise<void>> = {
  async view(h) {
    await setMode(h.page, "view");
    await expect(modeButton(h.page, "view")).toHaveAttribute("aria-pressed", "true");
  },
  async commentMode(h) {
    await setMode(h.page, "comment");
    await expect(modeButton(h.page, "comment")).toHaveAttribute("aria-pressed", "true");
    await h.page.mouse.move(2, 2);
  },
  async waitingClosed(h) {
    await askedThread(h);
    await closePanel(h.page);
    await expect(badge(h.page)).toBeVisible();
  },
  async panelOpen(h) {
    await postComment(h.page, "#cta", "panel is open");
    await openPanel(h.page);
  },
  async waitingOpen(h) {
    await askedThread(h);
    await openPanel(h.page);
    await expect(badge(h.page)).toBeHidden();
  },
  async hoverCta(h) {
    await setMode(h.page, "comment");
    await h.page.hover("#cta");
    await outline(h.page).waitFor();
    await expect(crumbs(h.page).first()).toBeVisible();
  },
  async pendingThread(h) {
    await postComment(h.page, "#cta", "still pending");
    await expect(h.page.locator(".tb-pin")).toBeVisible();
  },
  async waitingThread(h) {
    await askedThread(h);
    await expect(h.page.locator('.tb-pin[data-status="waiting"]')).toBeVisible();
  },
  async resolvedThread(h) {
    const id = await postComment(h.page, "#cta", "this one is done");
    await thread(h.page, id).locator(`[data-key="resolve-${id}"]`).click();
    await h.page.locator('[data-key="tab-resolved"]').click();
    await expect(chip(h.page, id)).toHaveText("resolved");
    await expect(h.page.locator('.tb-pin[data-status="resolved"]')).toBeVisible();
  },
  async pulsingPin(h) {
    const id = await postComment(h.page, "#cta", "find me");
    await thread(h.page, id).locator(`[data-key="top-${id}"]`).first().click();
    await expect(thread(h.page, id)).not.toHaveClass(/active/);
    await thread(h.page, id).locator(`[data-key="top-${id}"]`).first().click();
    await h.page.locator(".tb-pin.pulse").waitFor();
  },
  async receivedThread(h) {
    const id = await postComment(h.page, "#cta", "take this");
    await h.agent(["next"]);
    await expect(chip(h.page, id)).toHaveText("received", { timeout: 4000 });
  },
  async conversation(h) {
    const id = await postComment(h.page, "#cta", "a question from me");
    await h.agent(["next"]);
    await h.agent(["reply", id, "an answer from the agent"]);
    await expect(thread(h.page, id).locator(".tb-msg.agent")).toBeVisible({ timeout: 4000 });
  },
  async composerOpen(h) {
    await setMode(h.page, "comment");
    await h.page.hover("#cta");
    await outline(h.page).waitFor();
    await h.page.click("#cta");
    await expect(h.page.locator('[data-key="send"]')).toBeVisible();
  },
  async restoreConfirm(h) {
    const id = await postComment(h.page, "#cta", "rewind to here");
    await h.agent(["next"]);
    await expect(chip(h.page, id)).toHaveText("received", { timeout: 4000 });
    await thread(h.page, id).locator(".tb-restore button").first().click();
    await expect(h.page.locator(".tb-confirm .tb-btn.danger")).toBeVisible();
  },
  async notificationsDenied(h) {
    await fakeNotifications(h.page, "denied");
    await openPanel(h.page);
    await expect(h.page.locator(".tb-banner.blocked")).toBeVisible();
  },
  async historyView(h) {
    await discardedThread(h);
    await h.page.locator('[data-key="history"]').click();
    await h.page.locator(".tb-thread-top").first().click();
    await expect(h.page.locator(".tb-msg.tb-discarded")).toBeVisible();
  },
};
