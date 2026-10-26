import { test, expect } from "../fixtures/harness.ts";
import { outline, setMode } from "../fixtures/states.ts";
import type { Page } from "@playwright/test";

type Box = { x: number; y: number; w: number; h: number };

const rectOf = (page: Page, selector: string): Promise<Box> =>
  page.locator(selector).evaluate((e) => {
    const r = e.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });

const bandsOf = (page: Page, kind: string): Promise<(Box & { text: string })[]> =>
  page.locator(`.tb-band.${kind}`).evaluateAll((els) =>
    els.map((e) => {
      const r = e.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height, text: e.textContent ?? "" };
    }),
  );

function expectBox(got: Box, want: Box) {
  for (const k of ["x", "y", "w", "h"] as const) expect(got[k], k).toBeCloseTo(want[k], 1);
}

const addFixture = (page: Page) =>
  page.evaluate(() => {
    const box = document.createElement("div");
    box.innerHTML =
      `<div id="card" style="position:absolute;left:300px;top:400px;width:400px;margin:24px 16px 12px 40px;padding:10px 20px 30px 6px;display:flex;column-gap:16px;row-gap:8px">` +
      `<div class="part" style="width:80px;height:40px;padding:4px">a</div><div class="part" style="width:80px;height:40px">b</div><div class="part" style="width:80px;height:40px">c</div></div>` +
      `<div id="wrap" style="position:absolute;left:300px;top:600px;width:200px;display:flex;flex-wrap:wrap;gap:8px">` +
      `<div style="width:90px;height:20px">a</div><div style="width:90px;height:20px">b</div><div style="width:90px;height:20px">c</div></div>` +
      `<div id="contents" style="display:contents;margin:20px;padding:20px"><div id="inner" style="position:absolute;left:300px;top:700px;width:50px;height:30px">x</div></div>`;
    document.body.append(box);
  });

/** The pointer rests on the card's own top padding, so the card itself is the hovered element. */
async function overCard(page: Page) {
  const card = await rectOf(page, "#card");
  await page.mouse.move(card.x + card.w / 2, card.y + 4);
  await expect(outline(page)).toBeVisible();
  return card;
}

test("box_model", async ({ harness: h }) => {
  const page = h.page;
  await addFixture(page);
  const before = await page.evaluate(() => document.documentElement.outerHTML);
  await setMode(page, "comment");
  const card = await overCard(page);
  const boxes = page.locator(".tb-box");

  // without Control nothing shows
  await expect(boxes).toHaveCount(0);

  await page.keyboard.down("Control");
  await expect(boxes).toHaveCount(1);
  const margin = await bandsOf(page, "margin");
  expect(margin.map((b) => b.text)).toEqual(["24", "16", "12", "40"]);
  expectBox(margin[0]!, { x: card.x - 40, y: card.y - 24, w: card.w + 56, h: 24 });
  expectBox(margin[1]!, { x: card.x + card.w, y: card.y, w: 16, h: card.h });
  expectBox(margin[2]!, { x: card.x - 40, y: card.y + card.h, w: card.w + 56, h: 12 });
  expectBox(margin[3]!, { x: card.x - 40, y: card.y, w: 40, h: card.h });
  const padding = await bandsOf(page, "padding");
  expect(padding.map((b) => b.text)).toEqual(["10", "20", "30", "6"]);
  expectBox(padding[0]!, { x: card.x, y: card.y, w: card.w, h: 10 });
  expectBox(padding[1]!, { x: card.x + card.w - 20, y: card.y + 10, w: 20, h: card.h - 40 });
  expectBox(padding[2]!, { x: card.x, y: card.y + card.h - 30, w: card.w, h: 30 });
  expectBox(padding[3]!, { x: card.x, y: card.y + 10, w: 6, h: card.h - 40 });

  // gap: the number is in the label, the bands sit between the three children in their single row
  await expect(page.locator(".tb-outline-tag")).toContainText("gap 8 16");
  const parts = await page.locator(".part").evaluateAll((els) =>
    els.map((e) => {
      const r = e.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    }),
  );
  const gaps = await bandsOf(page, "gap");
  expect(gaps).toHaveLength(2);
  for (const [i, g] of gaps.entries()) expectBox(g, { x: parts[i]!.x + parts[i]!.w, y: parts[i]!.y, w: 16, h: parts[i]!.h });

  // the three kinds are three different colours: orange margin, green padding, blue gap
  const colour = (kind: string) => page.locator(`.tb-band.${kind}`).first().evaluate((e) => getComputedStyle(e).backgroundColor);
  expect([await colour("margin"), await colour("padding"), await colour("gap")]).toEqual(["rgba(246, 178, 107, 0.5)", "rgba(147, 196, 125, 0.5)", "rgba(111, 168, 220, 0.5)"]);

  // it follows the pointer to another element, and off every element it goes away
  const first = parts[0]!;
  await page.mouse.move(first.x + first.w / 2, first.y + first.h / 2);
  await expect(page.locator(".tb-outline-tag")).toHaveText("div.part");
  expect((await bandsOf(page, "padding")).map((b) => b.text)).toEqual(["4", "4", "4", "4"]);
  expect(await bandsOf(page, "margin")).toHaveLength(0);
  const cta = await rectOf(page, "#cta");
  await page.mouse.move(1000, cta.y + cta.h / 2);
  await expect(outline(page)).toHaveCount(0);
  await expect(boxes).toHaveCount(0);

  // releasing Control clears it, and pressing it again brings it back
  await overCard(page);
  await expect(boxes).toHaveCount(1);
  await page.keyboard.up("Control");
  await expect(boxes).toHaveCount(0);
  await page.keyboard.down("Control");
  await expect(boxes).toHaveCount(1);

  // a wrapped layout shows the number only
  const wrap = await rectOf(page, "#wrap");
  await page.mouse.move(wrap.x + wrap.w - 4, wrap.y + 4);
  await expect(page.locator(".tb-outline-tag")).toContainText("div#wrap  gap 8");
  expect(await bandsOf(page, "gap")).toHaveLength(0);

  // an element with no box of its own (display: contents) gets no bands, even with margin and padding
  await page.mouse.move(325, 715);
  await expect(page.locator(".tb-outline-tag")).toHaveText("div#inner");
  await page.keyboard.press("ArrowUp");
  await expect(page.locator(".tb-outline-tag")).toHaveText("div#contents");
  await expect(page.locator(".tb-band")).toHaveCount(0);

  // a window blur and a scroll clear it
  await overCard(page);
  await expect(boxes).toHaveCount(1);
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await expect(boxes).toHaveCount(0);
  await page.keyboard.up("Control");
  await page.keyboard.down("Control");
  await expect(boxes).toHaveCount(1);
  await page.evaluate(() => window.scrollTo(0, 100));
  await expect(boxes).toHaveCount(0);
  await page.evaluate(() => window.scrollTo(0, 0));

  // switching mode clears it
  await page.keyboard.up("Control");
  await overCard(page);
  await page.keyboard.down("Control");
  await expect(boxes).toHaveCount(1);
  await page.locator('.tb-modes [data-mode="view"]').evaluate((b) => (b as HTMLElement).click());
  await expect(boxes).toHaveCount(0);
  await page.keyboard.up("Control");
  await setMode(page, "comment");

  // Ctrl+click still picks the element and opens the composer, which clears it; Ctrl+Enter still sends
  await overCard(page);
  await page.keyboard.down("Control");
  await expect(boxes).toHaveCount(1);
  // macOS Chromium turns a real Ctrl+click into a context menu with no click, so send the click event itself
  await page.locator("#card").evaluate((e) => e.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true, cancelable: true, ctrlKey: true })));
  await expect(page.locator(".tb-composer .target")).toHaveText("div#card");
  await expect(boxes).toHaveCount(0);
  await page.keyboard.up("Control");
  await page.locator('[data-key="composer"]').fill("check the spacing");
  await page.keyboard.press("Control+Enter");
  await expect(page.locator(".tb-thread.active")).toHaveCount(1);

  // nothing in the page changed
  expect(await page.evaluate(() => document.documentElement.outerHTML)).toBe(before);
});

test("box_model stays cheap on a large page", async ({ harness: h }) => {
  const page = h.page;
  await page.evaluate(() => {
    let html = "";
    for (let s = 0; s < 200; s++) {
      html += `<div style="padding:4px;margin:2px">section ${s}`;
      for (let i = 0; i < 100; i++) html += `<div>item ${s}-${i} some text</div>`;
      html += "</div>";
    }
    const box = document.createElement("div");
    box.innerHTML = html;
    document.body.insertBefore(box, document.body.firstChild);
  });
  await setMode(page, "comment");
  await page.mouse.move(20, 20);
  await expect(outline(page)).toBeVisible();
  await page.keyboard.down("Control");
  await expect(page.locator(".tb-box")).toHaveCount(1);
  const slowest = await page.evaluate(() => {
    const items = Array.from(document.querySelectorAll("body > div > div > div")).filter((_, i) => i % 997 === 0).slice(0, 15);
    const times: number[] = [];
    for (const item of items) {
      const start = performance.now();
      item.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, composed: true }));
      times.push(performance.now() - start);
    }
    const start = performance.now();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Control", bubbles: true }));
    times.push(performance.now() - start);
    return Math.max(...times);
  });
  expect(slowest).toBeLessThan(10);
});
