import { test, expect } from "../fixtures/harness.ts";
import { openPanel, setMode } from "../fixtures/states.ts";

test("scroll links", async ({ harness: h }) => {
  const page = h.page;
  const scrollY = () => page.evaluate(() => window.scrollY);

  // comment on the heading far below the fold
  await page.evaluate(() => document.getElementById("far")!.scrollIntoView({ block: "center" }));
  await setMode(page, "comment");
  await page.hover("#far");
  await page.click("#far");
  await page.locator('[data-key="composer"]').fill("far away");
  await page.locator('[data-key="send"]').click();
  const id = (await page.locator(".tb-thread.active").getAttribute("data-id"))!;
  await expect(page.locator(".tb-pin")).toHaveCount(1);

  // scrolled back to the top, the pin is absent (the element is off screen)
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(page.locator(".tb-pin")).toHaveCount(0);

  // clicking the thread scrolls to the element, flashes it and pulses its pin
  await openPanel(page);
  await page.locator(`[data-key="top-${id}"]`).first().click(); // closes the open thread
  await expect(page.locator(`.tb-thread[data-id="${id}"].active`)).toHaveCount(0);
  expect(await scrollY()).toBe(0);
  await page.locator(`[data-key="top-${id}"]`).first().click();
  await expect.poll(scrollY).toBeGreaterThan(1000);
  const flash = page.locator(".tb-flash");
  await expect(flash).toBeVisible();
  const outline = await flash.evaluate((el) => {
    const s = getComputedStyle(el);
    return { width: s.outlineWidth, style: s.outlineStyle };
  });
  expect(outline).toEqual({ width: "2px", style: "solid" });
  const pin = page.locator(".tb-pin");
  await expect(pin).toHaveCount(1);
  await expect(pin).toHaveClass(/pulse/);
  expect(await pin.evaluate((el) => getComputedStyle(el).animationName)).toBe("tbpulse");
  // the flash box sits on the element once the scroll has settled
  await expect
    .poll(async () => {
      const target = (await page.locator("#far").boundingBox())!;
      const box = (await flash.boundingBox())!;
      return Math.abs(target.y - box.y) < 2 && Math.abs(target.height - box.height) < 2;
    })
    .toBe(true);

  // scrolled away again, the pin is gone; scrolled back, a pin click opens its thread
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(pin).toHaveCount(0);
  await page.locator(`[data-key="top-${id}"]`).first().click(); // close
  await page.evaluate(() => document.getElementById("far")!.scrollIntoView({ block: "center" }));
  await expect(pin).toHaveCount(1);
  await expect(page.locator(`.tb-thread[data-id="${id}"].active`)).toHaveCount(0);
  await pin.click();
  await expect(page.locator(`.tb-thread[data-id="${id}"].active`)).toBeVisible();
});
