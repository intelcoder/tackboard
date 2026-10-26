import { test, expect } from "../fixtures/harness.ts";
import { crumbs, outline, setMode, shot } from "../fixtures/states.ts";

test("nested_hover", async ({ harness: h }) => {
  const page = h.page;
  await setMode(page, "comment");
  const sameAsOutline = async (selector: string) => {
    const want = (await page.locator(selector).boundingBox())!;
    const got = (await outline(page).boundingBox())!;
    for (const k of ["x", "y", "width", "height"] as const) expect(got[k]).toBeCloseTo(want[k], 0);
  };

  await page.hover("#l4");
  await expect(outline(page)).toBeVisible();
  await sameAsOutline("#l4");
  for (const [i, id] of ["#l3", "#l2", "#l1"].entries()) {
    await page.keyboard.press("ArrowUp");
    await sameAsOutline(id);
    await expect(page.locator(".tb-crumbs button.on")).toHaveText(`div${id}`);
    if (i === 0) await shot(page, "nested_hover");
  }

  const labels = await crumbs(page).allTextContents();
  expect(labels).not.toContain("body");
  expect(labels).toEqual(["div#l1", "div#l2", "div#l3", "div#l4"]);

  await crumbs(page).filter({ hasText: "div#l2" }).click();
  await expect(page.locator(".tb-composer .target")).toHaveText("div#l2");
  expect(await page.evaluate(() => (window as any).__clicks)).toBe(0);

  // the page root never gets an outline
  await page.locator('[data-key="cancel"]').click();
  await setMode(page, "comment");
  const button = (await page.locator("#cta").boundingBox())!;
  await page.mouse.move(1000, button.y + button.height / 2);
  expect(await page.evaluate(([x, y]) => document.elementFromPoint(x!, y!)?.tagName, [1000, button.y + button.height / 2])).toBe("BODY");
  await expect(outline(page)).toHaveCount(0);
});
