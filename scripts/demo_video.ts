// Records the product demo: the real overlay, daemon and CLI on the playground bakery site. Run: node scripts/demo_video.ts [out-folder]
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { brand } from "../packages/shared/src/brand.ts";
import { startHarness } from "../e2e/fixtures/harness.ts";
import { closePanel, openPanel, setMode } from "../e2e/fixtures/states.ts";

const out = process.argv[2] ?? join(import.meta.dirname, "..", "demo");
mkdirSync(out, { recursive: true });
const h = await startHarness({ videoDir: join(out, "raw") });
const { page } = h;

// The bakery site, with the overlay script added the way a dev server would.
const site = join(import.meta.dirname, "..", "playground", "site");
cpSync(site, h.repo, { recursive: true });
const tag = `<script src="${h.daemonUrl}/${brand.bundle}"></script>`;
writeFileSync(join(h.repo, "index.html"), readFileSync(join(site, "index.html"), "utf8").replace("</head>", `${tag}</head>`));
await page.goto(h.siteUrl);
await page.locator(`#${brand.hostId}`).waitFor({ state: "attached" });

const pause = (ms: number) => page.waitForTimeout(ms);
const caption = (text: string) =>
  page.evaluate((t) => {
    let el = document.getElementById("demo-caption");
    if (!el) {
      el = document.createElement("div");
      el.id = "demo-caption";
      el.style.cssText = "position:fixed;left:40px;bottom:28px;z-index:2147483647;max-width:560px;padding:14px 26px;border-radius:12px;background:rgba(17,24,39,.92);color:#fff;font:600 20px/1.35 system-ui,sans-serif;text-align:center;pointer-events:none";
      document.body.append(el);
    }
    el.textContent = t;
  }, text);
const composer = page.locator('[data-key="composer"]');

async function draft(selector: string, text: string) {
  await setMode(page, "comment");
  await page.hover(selector);
  await page.locator(".tb-outline").waitFor();
  await pause(900);
  await page.click(selector);
  await composer.pressSequentially(text, { delay: 45 });
  await pause(500);
  await page.locator('[data-key="draft"]').click();
  await pause(900);
}

await caption("This is your live app.");
await pause(2500);
await caption("Click any element. Say what to change.");
await draft(".hero-title", "Make the headline bigger and warmer");
await draft(".special-card", "Add a small badge: 'Only 12 left'");
await draft(".allergy-note", "Move this above the footer");

await caption("Queue as many comments as you like, then send them all at once.");
await openPanel(page);
await page.getByRole("button", { name: "Dismiss" }).click(); // the browser-notification banner is noise in a demo
await pause(2500);
await page.locator('[data-key="send-all"]').click();
await pause(1500);

await caption("Your AI agent receives every comment, with the exact element, text and source.");
const next = await h.agent(["next"]);
await pause(3000);
const ids = [...next.stdout.matchAll(/THREAD (\S+)/g)].map((m) => m[1]!);
for (const id of ids) await h.agent(["reply", id, "Done. Is it OK to close this?", "--ask"]);
await caption("It replies on each thread. You stay in control: only you resolve.");
await pause(3500);

await caption("Resolve a thread when you're happy.");
const resolve = page.locator(`[data-key="resolve-${ids[0]}"]`);
if (!(await resolve.isVisible())) await page.locator(`[data-key="top-${ids[0]}"]`).first().click();
await pause(1500);
await resolve.click();
await pause(2500);

await caption("If the element is deleted, the comment is kept, with what it was.");
await page.evaluate(() => document.querySelector(".allergy-note")?.remove());
await page.locator(".tb-detached").waitFor({ timeout: 15000 });
await pause(4000);

await caption("Newest conversation first. Nothing gets lost.");
await closePanel(page);
await openPanel(page);
await pause(3500);

const video = page.video()!;
await page.close();
const raw = await video.path();
await h.stopAll();
console.log(raw);
