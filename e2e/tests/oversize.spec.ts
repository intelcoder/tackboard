import { brand } from "../../packages/shared/src/brand.ts";
import { test, expect } from "../fixtures/harness.ts";
import { postComment } from "../fixtures/states.ts";

test("oversize", async ({ harness: h }) => {
  const page = h.page;
  const healthy = async () => (await fetch(`${h.daemonUrl}/health`)).ok;

  // a 100 KB comment is accepted
  const big = "a".repeat(100 * 1024);
  const accepted = await postComment(page, "#cta", big);
  expect(accepted).toBeTruthy();
  expect(await healthy()).toBe(true);

  // a 150 KB comment shows an inline error in the composer and the daemon stays up
  await page.locator(".tb-modes [data-mode=comment]").click();
  await page.hover("#l4");
  await page.click("#l4");
  await page.locator('[data-key="composer"]').fill("b".repeat(150 * 1024));
  await page.locator('[data-key="send"]').click();
  const error = page.locator(".tb-composer .tb-error");
  await expect(error).toBeVisible();
  await expect(error).toContainText("100 KB");
  await expect(page.locator('[data-key="composer"]')).toBeVisible();
  expect(await healthy()).toBe(true);
  await page.locator('[data-key="cancel"]').click();
  // the refusal is the expected failed request, so take it out of the problems list
  expect(h.problems.filter((p) => p.includes("413"))).toHaveLength(2);
  h.problems.splice(0, h.problems.length, ...h.problems.filter((p) => !p.includes("413")));

  // an element with 1 MB of HTML is stored as a snippet of at most 4096 characters
  await page.evaluate(() => {
    const box = document.createElement("div");
    box.id = "huge";
    box.textContent = "word ".repeat(210000);
    document.body.insertBefore(box, document.getElementById("spacer"));
    if (box.outerHTML.length < 1024 * 1024) throw new Error("fixture element is smaller than 1 MB");
  });
  await h.agent(["next"]); // claims the 100 KB thread so the next call gets the huge one
  const huge = await postComment(page, "#huge", "huge element");
  const next = await h.agent(["next"]);
  expect(next.stdout).toContain(huge);
  const html = /html: (.*)/.exec(next.stdout);
  expect(html, next.stdout.slice(0, 600)).not.toBeNull();
  expect(html![1]!.length).toBeLessThanOrEqual(4096);
  expect(html![1]!.length).toBeGreaterThan(100);
  // `next` shows only a short clip of the html, so read what the daemon actually stored
  const token = await page.evaluate((name) => (globalThis as any)[name].token as string, brand.configGlobal);
  const listed = await (await fetch(`${h.daemonUrl}/threads`, { headers: { [brand.tokenHeader]: token } })).json();
  const stored = listed.threads.find((t: { id: string }) => t.id === huge);
  expect(stored.element.html.length).toBe(4096);
  expect(await healthy()).toBe(true);
});
