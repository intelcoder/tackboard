import { brand } from "../../packages/shared/src/brand.ts";
import { test, expect } from "../fixtures/harness.ts";
import { openPanel, postComment, thread } from "../fixtures/states.ts";

const IMG = `<img src=x onerror="window.__pwn=1">`;
const SCRIPT = `</script><script>window.__pwn=1</script>`;

test("xss", async ({ harness: h }) => {
  const page = h.page;
  const pwned = () => page.evaluate(() => (window as any).__pwn);

  // a user comment with both payloads
  const id = await postComment(page, "#cta", `${IMG} ${SCRIPT}`);
  const row = thread(page, id);
  await expect(row).toContainText(IMG);
  await expect(row).toContainText(SCRIPT);
  await page.waitForTimeout(500);
  expect(await pwned()).toBeUndefined();

  // agent replies with both payloads
  expect((await h.agent(["next"])).code).toBe(0);
  expect((await h.agent(["reply", id, IMG])).code).toBe(0);
  expect((await h.agent(["reply", id, SCRIPT])).code).toBe(0);
  await openPanel(page);
  await expect(row.locator(".tb-msg.agent .text")).toHaveCount(2, { timeout: 4000 });
  const texts = await row.locator(".tb-msg .text").allTextContents();
  expect(texts).toContain(IMG);
  expect(texts).toContain(SCRIPT);

  // the text became text nodes: no img or script element exists anywhere in the page's trees
  const elements = await page.evaluate((hostId) => {
    const root = document.getElementById(hostId)!.shadowRoot!;
    return { inside: root.querySelectorAll("img, script").length, outside: document.querySelectorAll("img").length };
  }, brand.hostId);
  expect(elements).toEqual({ inside: 0, outside: 0 });

  // still nothing after a reload that renders the stored messages again
  await page.reload();
  await page.locator(".tb-modes").waitFor();
  await openPanel(page);
  await expect(thread(page, id)).toBeVisible();
  await page.waitForTimeout(500);
  expect(await pwned()).toBeUndefined();
});
