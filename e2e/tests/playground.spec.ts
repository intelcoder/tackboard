import { execFile, execFileSync, spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { existsSync, readFileSync, realpathSync, symlinkSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { chromium, expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { brand } from "../../packages/shared/src/brand.ts";
import { outline, postComment, setMode, shot } from "../fixtures/states.ts";

const root = join(import.meta.dirname, "..", "..");
const cli = join(root, "packages", "cli", "src", "main.ts");

const repoStatus = () => execFileSync("git", ["status", "--short"], { cwd: root, encoding: "utf8" });

function runCli(folder: string, args: string[]): Promise<string> {
  return new Promise((done) => {
    execFile("node", [cli, ...args], { cwd: folder }, (_err, stdout) => done(stdout));
  });
}

/** Starts the playground and waits until it has printed everything. */
function startPlayground(): Promise<{ child: ChildProcess; site: string; daemon: string; folder: string }> {
  const child = spawn("node", [join(root, "scripts", "playground.ts")], { cwd: root, stdio: ["ignore", "pipe", "ignore"] });
  return new Promise((done, fail) => {
    let seen = "";
    const timer = setTimeout(() => fail(new Error(`the playground did not start: ${seen}`)), 60000);
    child.once("exit", () => fail(new Error(`the playground stopped early: ${seen}`)));
    child.stdout!.on("data", (d) => {
      seen += d;
      if (!seen.includes("Press Ctrl+C")) return;
      clearTimeout(timer);
      const line = (label: string) => new RegExp(`^${label}: (.+)$`, "m").exec(seen)![1]!;
      done({ child, site: line("Playground site"), daemon: line("Comments daemon"), folder: line("Project folder") });
    });
  });
}

const gone = (address: string) => fetch(address).then(() => false, () => true);

test("the playground works on every page and leaves this repo alone", async () => {
  test.setTimeout(150000);
  const repoBefore = repoStatus();
  const play = await startPlayground();
  const browser = await chromium.launch();
  try {
    expect(play.site).toMatch(/^http:\/\/localhost:\d+$/);
    // only the site folder is served, not the copy's root with the git data and the token
    const rootToken = (JSON.parse(readFileSync(join(play.folder, ".tackboard", "config.json"), "utf8")) as { token: string }).token;
    for (const [path, status] of [["/index.html", 200], ["/site/index.html", 404], ["/.tackboard/config.json", 404]] as const) {
      const answer = await fetch(`${play.site}${path}`);
      expect(answer.status, path).toBe(status);
      expect(await answer.text(), path).not.toContain(rootToken);
    }
    expect(existsSync(join(play.folder, ".git")), "the copy has its own .git").toBe(true);
    expect(existsSync(join(play.folder, "site", "index.html")), "the pages are in the site folder").toBe(true);
    expect(realpathSync(execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: play.folder, encoding: "utf8" }).trim())).toBe(realpathSync(play.folder));
    expect(execFileSync("git", ["rev-list", "--count", "HEAD"], { cwd: play.folder, encoding: "utf8" }).trim()).toBe("1");

    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const problems: string[] = [];
    page.on("console", (m) => m.type() === "error" && problems.push(`console: ${m.text()}`));
    page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
    page.on("requestfailed", (r) => problems.push(`request failed: ${r.url()}`));
    page.on("response", (r) => r.status() >= 400 && problems.push(`response ${r.status()}: ${r.url()}`));

    const openPage = async (path: string) => {
      await page.goto(`${play.site}${path}`);
      await page.locator(`#${brand.hostId}`).waitFor({ state: "attached" });
      await expect(page.locator(".tb-modes")).toBeVisible();
      for (const width of [1280, 320]) {
        await page.setViewportSize({ width, height: 800 });
        const wider = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(wider, `${path} scrolls sideways at ${width} wide by`).toBeLessThanOrEqual(0);
      }
      await page.setViewportSize({ width: 1280, height: 800 });
    };

    // both pages: a comment on the page title reaches the daemon with that page's address
    const wanted: string[] = [];
    for (const path of ["/index.html", "/order.html"]) {
      await openPage(path);
      await postComment(page, "h1", `comment on ${path}`);
      wanted.push(`${play.site}${path}`);
    }
    const status = await runCli(play.folder, ["status"]);
    expect(status.split("\n").filter((l) => l.startsWith("#"))).toHaveLength(2);
    const pages: string[] = [];
    for (let i = 0; i < 2; i++) pages.push(/^page: (\S+)/m.exec(await runCli(play.folder, ["next"]))![1]!);
    expect(pages.sort()).toEqual(wanted.sort());
    expect(new Set(pages).size).toBe(2);

    // a link from the home page to the order page keeps the overlay
    await openPage("/index.html");
    await page.locator('nav a[href="order.html"]').click();
    await expect(page).toHaveURL(`${play.site}/order.html`);
    await page.locator(`#${brand.hostId}`).waitFor({ state: "attached" });
    await expect(page.locator(".tb-modes")).toBeVisible();

    // Control over the product card row shows the gap strips
    await openPage("/index.html");
    await setMode(page, "comment");
    const row = (await page.locator("#product-row").boundingBox())!;
    await page.mouse.move(row.x + row.width / 2, row.y + 4);
    await expect(outline(page)).toBeVisible();
    await page.keyboard.down("Control");
    await expect(page.locator(".tb-strip.gap")).toHaveCount(2);
    await shot(page, "playground-product-row");
    await page.keyboard.up("Control");

    // a page with 20000 extra items loads, and a scroll event stays fast with the overlay on
    await openPage("/index.html?fill=20000");
    await expect(page.locator(".fill-item")).toHaveCount(20000);
    const slowest = await page.evaluate(() => {
      const times: number[] = [];
      for (let i = 0; i < 12; i++) {
        const start = performance.now();
        window.dispatchEvent(new Event("scroll"));
        times.push(performance.now() - start);
      }
      return Math.max(...times);
    });
    expect(slowest, "slowest scroll event (ms)").toBeLessThan(10);

    // a link inside the site folder that points at the daemon's data gets 404, and the token is in no answer
    const token = (JSON.parse(readFileSync(join(play.folder, ".tackboard", "config.json"), "utf8")) as { token: string }).token;
    const link = join(play.folder, "site", "x.txt");
    symlinkSync("../.tackboard/config.json", link);
    try {
      expect((await fetch(`${play.site}/x.txt`)).status).toBe(404);
      for (const path of ["/x.txt", "/.tackboard/config.json", "/index.html", "/order.html", "/playground.css", "/playground.js"]) {
        expect(await (await fetch(`${play.site}${path}`)).text(), path).not.toContain(token);
      }
    } finally {
      unlinkSync(link);
    }

    expect(problems, "console errors and failed requests").toEqual([]);

    // Ctrl+C: both servers stop and the folder stays
    const stopped = new Promise<number | null>((done) => play.child.once("exit", (code) => done(code)));
    play.child.kill("SIGINT");
    expect(await stopped).toBe(0);
    expect(await gone(play.site)).toBe(true);
    expect(await gone(play.daemon)).toBe(true);
    expect(existsSync(join(play.folder, ".git"))).toBe(true);
    expect(repoStatus(), "this repo's git status").toBe(repoBefore);
  } finally {
    if (play.child.exitCode === null) play.child.kill("SIGKILL");
    await browser.close();
  }
});
