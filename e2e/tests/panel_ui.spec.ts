import { test, expect } from "../fixtures/harness.ts";
import { badge, closePanel, openPanel, panelToggle, postComment, setMode, shot } from "../fixtures/states.ts";

const inside = (box: { x: number; y: number; width: number; height: number }, w: number, h: number) =>
  box.x >= 0 && box.y >= 0 && box.x + box.width <= w && box.y + box.height <= h;

test("panel ui", async ({ harness: h }) => {
  const page = h.page;
  const panel = page.locator(".tb-panel");
  const idOf = async () => (await page.locator(".tb-thread.active").getAttribute("data-id"))!;

  // closed on load, the chat icon opens and closes it
  await expect(panel).toBeHidden();
  await expect(panelToggle(page)).toHaveAttribute("aria-pressed", "false");
  await panelToggle(page).click();
  await expect(panel).toBeVisible();
  await panelToggle(page).click();
  await expect(panel).toBeHidden();

  // starting a comment opens it
  await setMode(page, "comment");
  await page.hover("#cta");
  await page.click("#cta");
  await expect(panel).toBeVisible();
  await expect(page.locator('[data-key="composer"]')).toBeVisible();
  await page.locator('[data-key="composer"]').fill("panel test");
  await page.locator('[data-key="send"]').click();
  const id = await idOf();

  // a pin click opens it
  await closePanel(page);
  await expect(panel).toBeHidden();
  await page.locator(".tb-pin").click();
  await expect(panel).toBeVisible();
  await expect(page.locator(`.tb-thread[data-id="${id}"].active`)).toBeVisible();

  // the badge counts waiting threads and is hidden while the panel is open
  expect((await h.agent(["next"])).code).toBe(0);
  expect((await h.agent(["reply", id, "which one?", "--ask"])).code).toBe(0);
  await expect(page.locator(".tb-chip")).toHaveText("waiting on you", { timeout: 3000 });
  await expect(badge(page)).toBeHidden();
  await closePanel(page);
  await expect(badge(page)).toBeVisible();
  await expect(badge(page)).toHaveText("1");
  await openPanel(page);
  await expect(badge(page)).toBeHidden();
  await shot(page, "panel_open_1280");

  // at 390 px wide the untouched panel is 362 px (screen minus the 14 px gutters), inside the screen and clear of the pill
  await page.setViewportSize({ width: 390, height: 800 });
  await expect.poll(async () => (await panel.boundingBox())!.width).toBe(362);
  const narrow = (await panel.boundingBox())!;
  const pill = (await page.locator(".tb-modes").boundingBox())!;
  expect(inside(narrow, 390, 800)).toBe(true);
  expect(narrow.y + narrow.height).toBeLessThanOrEqual(pill.y);
  await shot(page, "panel_open_390");
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect.poll(async () => (await panel.boundingBox())!.x).toBeGreaterThan(800);

  // dragging the header moves the panel and keeps it inside the viewport
  const before = (await panel.boundingBox())!;
  const head = (await page.locator(".tb-title").boundingBox())!;
  await page.mouse.move(head.x + 30, head.y + head.height / 2);
  await page.mouse.down();
  await page.mouse.move(head.x - 200, head.y - 150, { steps: 6 });
  await page.mouse.up();
  const moved = (await panel.boundingBox())!;
  expect(moved.x).toBeLessThan(before.x - 100);
  expect(moved.y).toBeLessThan(before.y - 100);
  expect(inside(moved, 1280, 800)).toBe(true);

  // dragging far past the edge is stopped at the edge
  await page.mouse.move(moved.x + 30, moved.y + 15);
  await page.mouse.down();
  await page.mouse.move(-500, -500, { steps: 6 });
  await page.mouse.up();
  const corner = (await panel.boundingBox())!;
  expect(corner.x).toBe(0);
  expect(corner.y).toBe(0);

  // dragged to the right edge, a resize to 320 px clamps it back inside
  await page.mouse.move(corner.x + 30, corner.y + 15);
  await page.mouse.down();
  await page.mouse.move(1270, 400, { steps: 6 });
  await page.mouse.up();
  const right = (await panel.boundingBox())!;
  expect(right.x + right.width).toBeGreaterThan(1200);
  await page.setViewportSize({ width: 320, height: 800 });
  await expect.poll(async () => inside((await panel.boundingBox())!, 320, 800)).toBe(true);
  await shot(page, "panel_dragged_then_320");

  // the X closes it
  await page.locator('[data-key="close"]').click();
  await expect(panel).toBeHidden();
  await expect(panelToggle(page)).toHaveAttribute("aria-pressed", "false");
});
