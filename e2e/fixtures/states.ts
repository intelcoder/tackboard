import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";

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
