import { brand } from "../../packages/shared/src/brand.ts";
import { test, expect } from "../fixtures/harness.ts";
import { openPanel, outline, setMode } from "../fixtures/states.ts";

test("large page", async ({ harness: h }) => {
  test.setTimeout(120000);
  const page = h.page;
  const token = await page.evaluate((name) => (globalThis as any)[name].token as string, brand.configGlobal);
  const here = `${h.siteUrl}/`;

  // 20 000 divs
  await page.evaluate(() => {
    let html = "";
    for (let s = 0; s < 200; s++) {
      html += `<div>section ${s}`;
      for (let i = 0; i < 100; i++) html += `<div>item ${s}-${i} some text</div>`;
      html += "</div>";
    }
    const box = document.createElement("div");
    box.innerHTML = html;
    document.body.insertBefore(box, document.body.firstChild);
  });

  const post = async (selector: string, text: string, url: string) => {
    const element = { selector, tag: "div", text, html: "<div></div>", rect: { x: 0, y: 0, w: 100, h: 20 }, confidence: "text" };
    const res = await fetch(`${h.daemonUrl}/threads`, {
      method: "POST",
      headers: { [brand.tokenHeader]: token, "content-type": "application/json" },
      body: JSON.stringify({ element, url, viewport: { w: 1280, h: 800 }, text: "please fix this" }),
    });
    expect(res.ok).toBe(true);
  };
  const postMany = async (count: number, start: number, url: string) => {
    for (let i = start; i < start + count; i += 10) {
      await Promise.all(Array.from({ length: Math.min(10, start + count - i) }, (_, k) => post(`#gone${i + k}`, `text that no longer exists ${i + k}`, url)));
    }
  };
  await postMany(30, 0, here);
  const away = `${h.siteUrl}/other.html`;
  for (let i = 0; i < 30; i++) await post(`#away${i}`, `other page text ${i}`, away);
  await page.waitForTimeout(3500); // a couple of polls bring the threads in

  const scrollMs = await page.evaluate(() => {
    const times: number[] = [];
    for (let i = 0; i < 12; i++) {
      const start = performance.now();
      window.dispatchEvent(new Event("scroll"));
      times.push(performance.now() - start);
    }
    return Math.max(...times);
  });
  expect(scrollMs, "slowest scroll event (ms)").toBeLessThan(10);

  const slowestTask = (ms: number) => page.evaluate(async (wait) => {
    const longest: number[] = [0];
    const watch = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) longest.push(entry.duration);
    });
    watch.observe({ entryTypes: ["longtask"] });
    await new Promise((done) => setTimeout(done, wait));
    watch.disconnect();
    return Math.max(...longest);
  }, ms);
  expect(await slowestTask(6000), "slowest task while idle (ms)").toBeLessThan(100);

  // panel open, 200 threads on this page
  await postMany(170, 30, here);
  await page.waitForTimeout(3500);
  await openPanel(page);
  expect(await slowestTask(6000), "slowest task with the panel open (ms)").toBeLessThan(100);
});

test("a queued message shows at most 300 characters and does not slow layout", async ({ harness: h }) => {
  const page = h.page;
  await page.route(`${h.daemonUrl}/threads`, (route) =>
    route.request().method() === "POST"
      ? route.fulfill({ status: 400, contentType: "application/json", body: '{"error":"invalid","message":"not accepted"}' })
      : route.continue());
  await setMode(page, "comment");
  await page.hover("#cta");
  await outline(page).waitFor();
  await page.click("#cta");
  await page.locator('[data-key="composer"]').fill("x".repeat(150 * 1024));
  await page.locator('[data-key="composer"]').press("Control+Enter");
  const item = page.locator(".tb-queued .text");
  await expect(item).toBeVisible();
  expect((await item.textContent())!.length).toBeLessThanOrEqual(300);
  const relayout = await page.evaluate(() => {
    const start = performance.now();
    document.body.style.paddingTop = "1px";
    document.documentElement.getBoundingClientRect();
    return performance.now() - start;
  });
  expect(relayout, "relayout (ms)").toBeLessThan(100);
  h.problems.length = 0; // the refused request is expected
});
