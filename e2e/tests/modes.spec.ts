import { test, expect } from "../fixtures/harness.ts";
import { modeButton, panelToggle, postComment, setMode } from "../fixtures/states.ts";

test("modes", async ({ harness: h }) => {
  const page = h.page;
  let polls = 0;
  page.on("request", (r) => {
    if (new URL(r.url()).pathname === "/threads" && r.method() === "GET") polls++;
  });
  const id = await postComment(page, "#cta", "pin me");
  await expect(page.locator(".tb-pin")).toHaveCount(1);

  await setMode(page, "hidden");
  await expect(page.locator(".tb-pin")).toHaveCount(0);
  await expect(page.locator(".tb-outline")).toHaveCount(0);
  await expect(page.locator(".tb-panel:not([hidden])")).toHaveCount(0);
  await expect(panelToggle(page)).toBeDisabled();
  await page.waitForTimeout(300);
  polls = 0;
  await page.waitForTimeout(4000);
  expect(polls).toBe(0);

  await setMode(page, "view");
  await expect(page.locator(".tb-pin")).toHaveCount(1);
  await page.click("#cta");
  expect(await page.evaluate(() => (window as any).__clicks)).toBe(1);

  await setMode(page, "comment");
  await page.hover("#cta");
  await page.click("#cta");
  expect(await page.evaluate(() => (window as any).__clicks)).toBe(1);
  await page.locator('[data-key="cancel"]').click();

  await setMode(page, "hidden");
  await page.waitForTimeout(300);
  polls = 0;
  await setMode(page, "view");
  await expect.poll(() => polls, { timeout: 4000 }).toBeGreaterThan(0);
  expect(id).toBeTruthy();
  await expect(modeButton(page, "view")).toHaveAttribute("aria-pressed", "true");
});
