import { brand } from "../../packages/shared/src/brand.ts";
import { test, expect } from "../fixtures/harness.ts";
import { chip, openPanel, postComment, thread } from "../fixtures/states.ts";

test("stale claim", async ({ harness: h }) => {
  const page = h.page;
  const id = await postComment(page, "#cta", "claimed and forgotten");
  const token = await page.evaluate((name) => (globalThis as any)[name].token as string, brand.configGlobal);
  const list = async () => (await (await fetch(`${h.daemonUrl}/threads`, { headers: { [brand.tokenHeader]: token } })).json()) as { restoreBlocked: string | null; threads: { id: string; claimStale: boolean }[] };

  const first = await h.agent(["next", "--as", "agent-a"]);
  expect(first.stdout).toContain(id);
  await expect(chip(page, id)).toHaveText("received", { timeout: 4000 });
  // a fresh claim blocks restore and is not stale
  expect((await list()).restoreBlocked).not.toBeNull();
  expect((await list()).threads[0]!.claimStale).toBe(false);

  // 31 minutes later: the claim is stale and restore is allowed
  await h.restartDaemon({ [`${brand.envPrefix}CLOCK_OFFSET_MIN`]: "31" });
  const later = await list();
  expect(later.threads[0]!.claimStale).toBe(true);
  expect(later.restoreBlocked).toBeNull();

  await page.reload();
  await page.locator(".tb-modes").waitFor();
  await openPanel(page);
  await thread(page, id).locator(`[data-key="top-${id}"]`).first().click();
  await expect(thread(page, id)).toContainText("This claim is more than 30 minutes old");
  await thread(page, id).locator(".tb-restore button").first().click();
  await expect(page.locator(".tb-confirm")).toBeVisible();
  await expect(page.locator(".tb-confirm .tb-btn.danger")).toBeEnabled();
  await expect(page.locator(".tb-confirm .tb-reason")).toHaveCount(0);
  await page.locator(".tb-confirm [data-keep]").click();

  // another agent can claim it again
  const second = await h.agent(["next", "--as", "agent-b"]);
  expect(second.stdout).toContain(id);
});
