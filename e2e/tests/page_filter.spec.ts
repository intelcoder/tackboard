import { copyFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect } from "../fixtures/harness.ts";
import { chip, openPanel, postComment, shot } from "../fixtures/states.ts";

test("next --url takes only that page's comment, and Copy agent prompt puts that command on the clipboard", async ({ harness: h }) => {
  const page = h.page;
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin: h.siteUrl });
  copyFileSync(join(h.repo, "index.html"), join(h.repo, "pricing.html"));

  const home = await postComment(page, "#cta", "home note");
  await page.goto(`${h.siteUrl}/pricing.html`);
  const pricing = await postComment(page, "#cta", "pricing note");

  // The button copies the command for this page.
  await openPanel(page);
  const button = page.locator('[data-key="copy-prompt"]');
  await expect(button).toBeVisible();
  await button.click();
  await expect(page.locator(".tb-toast")).toHaveText("Agent prompt copied");
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain("`tackboard wait --url /pricing.html`");

  // An agent that runs the copied command gets this page only; the other page's comment stays waiting.
  const only = (await h.agent(["next", "--url", "/pricing.html"])).stdout;
  expect(only).toContain("pricing note");
  expect(only).not.toContain("home note");
  await expect(chip(page, pricing)).toContainText(/received/i, { timeout: 5000 });
  const rest = (await h.agent(["next"])).stdout;
  expect(rest).toContain("home note");
  expect(rest).not.toContain("pricing note");
  expect(home).not.toBe(pricing);
});

test("the footer buttons fit at every width in both themes", async ({ harness: h }) => {
  const page = h.page;
  await postComment(page, "#cta", "look at this");
  await page.locator(".tb-thread.active").waitFor();
  await openPanel(page);
  for (const [w, height] of [[1280, 800], [390, 800], [320, 700]] as const) {
    for (const scheme of ["light", "dark"] as const) {
      await page.setViewportSize({ width: w, height });
      await page.emulateMedia({ colorScheme: scheme });
      const panel = (await page.locator(".tb-panel").boundingBox())!;
      for (const key of ["copy-prompt", "history"]) {
        const box = (await page.locator(`[data-key="${key}"]`).boundingBox())!;
        expect(box.x >= panel.x && box.x + box.width <= panel.x + panel.width, `${key} inside the panel at ${w}px`).toBe(true);
        expect(await page.locator(`[data-key="${key}"]`).evaluate((e) => e.scrollWidth <= e.clientWidth), `${key} text not cut at ${w}px`).toBe(true);
      }
      await page.locator(".tb-foot").screenshot({ path: join(import.meta.dirname, "..", "artifacts", `foot_${w}_${scheme}.png`) });
      await shot(page, `copy_prompt_${w}_${scheme}`);
    }
  }
});
