import { test, expect } from "../fixtures/harness.ts";

test("a comment can point at more than one element; the agent gets all of them", async ({ harness: h }) => {
  const page = h.page;
  await page.locator(".tb-modes [data-mode=comment]").click();
  await page.hover("#cta");
  await page.click("#cta");
  await page.locator('[data-key="composer"]').fill("these two are not aligned");

  await page.locator('[data-key="add-element"]').click();
  await expect(page.getByText("Click another element on the page")).toBeVisible();
  await page.hover("#l4");
  await page.click("#l4");
  // The box is back, with the second element as a chip, and the text typed so far is kept.
  await expect(page.locator(".tb-chip")).toHaveCount(1);
  await expect(page.locator('[data-key="composer"]')).toHaveValue("these two are not aligned");

  // A removed chip is gone; picking the first element again adds nothing.
  await page.locator('[data-key="remove-also-0"]').click();
  await expect(page.locator(".tb-chip")).toHaveCount(0);
  await page.locator('[data-key="add-element"]').click();
  await page.hover("#cta");
  await page.click("#cta");
  await expect(page.locator(".tb-chip")).toHaveCount(0);

  await page.locator('[data-key="add-element"]').click();
  await page.hover("#l4");
  await page.click("#l4");
  await page.locator('[data-key="send"]').click();
  await expect(page.locator(".tb-thread.active")).toBeVisible();

  const next = await h.agent(["next"]);
  expect(next.stdout).toContain("selector: #cta");
  expect(next.stdout).toMatch(/also this element: <div>/);
});

test("Esc while picking one more element gives the comment box back", async ({ harness: h }) => {
  const page = h.page;
  await page.locator(".tb-modes [data-mode=comment]").click();
  await page.hover("#cta");
  await page.click("#cta");
  await page.locator('[data-key="composer"]').fill("keep me");
  await page.locator('[data-key="add-element"]').click();
  await page.keyboard.press("Escape");
  await expect(page.locator('[data-key="composer"]')).toHaveValue("keep me");
  await expect(page.locator('[data-key="add-element"]')).toBeVisible();
});
