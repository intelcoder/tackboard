import { test, expect } from "../fixtures/harness.ts";
import type { Page } from "@playwright/test";
import { openPanel, postComment, shot } from "../fixtures/states.ts";

/** The pill must stay inside the panel and be readable at every width, in both themes. */
async function shots(page: Page, state: string): Promise<void> {
  for (const [w, h] of [[1280, 800], [390, 800], [320, 700]] as const) {
    for (const scheme of ["light", "dark"] as const) {
      await page.setViewportSize({ width: w, height: h });
      await page.emulateMedia({ colorScheme: scheme });
      const pill = await page.locator(".tb-agent").boundingBox();
      expect(await page.locator(".tb-agent").evaluate((e) => e.scrollWidth <= e.clientWidth), `${state} text not cut at ${w}px`).toBe(true);
      expect(pill && pill.x >= 0 && pill.x + pill.width <= w, `${state} pill inside ${w}px`).toBe(true);
      await shot(page, `agent_${state}_${w}_${scheme}`);
    }
  }
}

test("the panel and status show listening, then idle, with the reason", async ({ harness: h }) => {
  const page = h.page;
  await postComment(page, "#cta", "look at this");
  await openPanel(page);
  const pill = page.locator(".tb-agent");
  await expect(pill).toHaveAttribute("data-state", "none");
  await expect(pill).toHaveText("no agent");
  await shots(page, "none");

  await h.agent(["next"]);
  await expect(pill).toHaveAttribute("data-state", "listening", { timeout: 5000 });
  await expect(pill).toHaveText("listening");
  await shots(page, "listening");
  expect((await h.agent(["status"])).stdout).toContain("(listening)");

  // 8 s after its last question the agent is idle, not "not connected"; the comments stay.
  await expect(pill).toHaveAttribute("data-state", "idle", { timeout: 20_000 });
  await expect(pill).toHaveText(/^idle · \d+ s$/);
  await shots(page, "idle");

  // The age in the pill ticks without the panel being rebuilt (the render is memoized on `look`).
  await page.locator(".tb-thread").first().evaluate((e) => ((e as HTMLElement & { kept?: number }).kept = 1));
  const first = await pill.textContent();
  await expect(pill).not.toHaveText(first!, { timeout: 10_000 });
  expect(await page.locator(".tb-thread").first().evaluate((e) => (e as HTMLElement & { kept?: number }).kept)).toBe(1);
  await expect(pill).toHaveAttribute("title", /busy or between two waits.*`tackboard wait`/);
  const status = (await h.agent(["status"])).stdout;
  expect(status).toMatch(/agent: ai-agent \(idle · \d+ s\)/);
  expect(status).toContain("`tackboard wait`");
});
