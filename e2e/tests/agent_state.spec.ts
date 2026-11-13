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
  expect((await h.agent(["status"])).stdout).toContain("(listening)"); // before the shots: the window is 8 s
  await shots(page, "listening");

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

test("a toast says which agent connected, once, and not for an agent already there at page load", async ({ harness: h }) => {
  const page = h.page;
  await openPanel(page);
  await expect(page.locator(".tb-agent")).toHaveAttribute("data-state", "none");

  await page.setViewportSize({ width: 320, height: 700 });
  await page.emulateMedia({ colorScheme: "dark" });
  await h.agent(["next"]);
  const toast = page.locator(".tb-toast");
  await expect(toast).toHaveText("ai-agent is connected", { timeout: 5000 });
  // Measured at once: the toast lives 3.5 s.
  const box = await toast.boundingBox();
  expect(box && box.x >= 0 && box.x + box.width <= 320, "toast inside 320px").toBe(true);
  await shot(page, "agent_toast_320_dark");
  await expect(toast).toHaveCount(0, { timeout: 6000 });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ colorScheme: "light" });

  // Still the same agent a few seconds later: no second toast.
  await h.agent(["next"]);
  await page.waitForTimeout(3000);
  await expect(page.locator(".tb-toast")).toHaveCount(0);

  // A reload with the agent already there starts quiet.
  await page.reload();
  await openPanel(page);
  await expect(page.locator(".tb-agent")).toHaveAttribute("data-state", /listening|idle/);
  await page.waitForTimeout(2500);
  await expect(page.locator(".tb-toast")).toHaveCount(0);

  // A second agent: its name reaches the pill's title and gets its own toast.
  await h.agent(["next", "--as", "codex"]);
  await expect(page.locator(".tb-agent")).toHaveAttribute("title", /codex/, { timeout: 5000 });
  await expect(page.locator(".tb-toast")).toHaveText("codex is connected", { timeout: 5000 });
});
