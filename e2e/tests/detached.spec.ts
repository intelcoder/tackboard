import { writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect } from "../fixtures/harness.ts";
import { openPanel, postComment, thread } from "../fixtures/states.ts";

test("detached", async ({ harness: h }) => {
  const page = h.page;
  const id = await postComment(page, "#cta", "this button moved");
  await expect(page.locator(".tb-pin")).toHaveCount(1);
  await expect(page.locator(".tb-detached")).toHaveCount(0);

  // the agent removes the button from the page
  const file = join(h.repo, "index.html");
  const html = readFileSync(file, "utf8");
  writeFileSync(file, html.replace(/<button id="cta">[^<]*<\/button>/, "").replace(/<script>window\.__clicks[^]*?<\/script>/, ""));
  expect(readFileSync(file, "utf8")).not.toContain('id="cta"');
  await page.reload();
  await page.locator(".tb-modes").waitFor();
  await expect(page.locator("#cta")).toHaveCount(0);
  await openPanel(page);

  // the thread is listed as detached, with the note, and has no pin
  const group = page.locator(".tb-detached");
  await expect(group).toContainText("Element missing (1)");
  const row = group.locator(`.tb-thread[data-id="${id}"]`);
  await expect(row).toBeVisible();
  await expect(row.locator(".tb-note")).toHaveText("element missing");
  await expect(page.locator(".tb-pin")).toHaveCount(0);

  // and it can still be answered
  await row.locator(".tb-thread-top").click();
  await row.locator(`[data-key="reply-${id}"]`).fill("still here?");
  await row.locator(`[data-key="send-${id}"]`).click();
  await expect(thread(page, id)).toContainText("still here?");
  const next = await h.agent(["next"]);
  expect(next.stdout).toContain("still here?");
  await expect(page.locator(".tb-pin")).toHaveCount(0);
});
