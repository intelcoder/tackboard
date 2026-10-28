import { execFile, execFileSync, spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { appendFileSync, chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
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
function startPlayground(): Promise<{ child: ChildProcess; site: string; daemon: string; folder: string; output: () => string }> {
  const child = spawn("node", [join(root, "scripts", "playground.ts")], { cwd: root, stdio: ["pipe", "pipe", "ignore"] });
  return new Promise((done, fail) => {
    let seen = "";
    let started = false;
    const timer = setTimeout(() => fail(new Error(`the playground did not start: ${seen}`)), 60000);
    child.once("exit", () => fail(new Error(`the playground stopped early: ${seen}`)));
    child.stdout!.on("data", (d) => {
      seen += d;
      if (started || !seen.includes("Press Ctrl+C")) return;
      started = true;
      clearTimeout(timer);
      const line = (label: string) => new RegExp(`^${label}: (.+)$`, "m").exec(seen)![1]!;
      done({ child, site: line("Playground site"), daemon: line("Comments daemon"), folder: line("Project folder"), output: () => seen });
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
    const pages = [...(await runCli(play.folder, ["next"])).matchAll(/^page: (\S+)/gm)].map((m) => m[1]!);
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

/** Types a word into the playground's terminal and waits until it prints `answer` once more. */
async function type(play: { child: ChildProcess; output: () => string }, word: string, answer: string): Promise<void> {
  const before = play.output().split(answer).length;
  play.child.stdin!.write(`${word}\n`);
  await expect.poll(() => play.output().split(answer).length, { timeout: 40000, message: `waiting for "${answer}"` }).toBeGreaterThan(before);
}

const DONE = "files are back to the first version, comments cleared";
const git = (folder: string, ...args: string[]) => execFileSync("git", args, { cwd: folder, encoding: "utf8" });
const readConfig = (folder: string) => readFileSync(join(folder, ".tackboard", "config.json"), "utf8");
const threadLines = async (folder: string) => (await runCli(folder, ["status"])).split("\n").filter((l) => l.startsWith("#"));

async function stop(play: { child: ChildProcess }): Promise<void> {
  const stopped = new Promise((done) => play.child.once("exit", done));
  play.child.kill("SIGINT");
  await stopped;
}

test("reset puts the copy back as it started and the open page keeps working", async () => {
  test.setTimeout(150000);
  const repoBefore = repoStatus();
  const play = await startPlayground();
  const browser = await chromium.launch();
  try {
    const first = git(play.folder, "rev-parse", "HEAD").trim();
    const config = readConfig(play.folder);
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto(`${play.site}/index.html`);
    await page.locator(`#${brand.hostId}`).waitFor({ state: "attached" });
    await postComment(page, "h1", "before the reset");
    expect(await threadLines(play.folder)).toHaveLength(1);
    await runCli(play.folder, ["next"]); // the agent takes the comment, which saves a snapshot
    expect(git(play.folder, "for-each-ref", brand.refPrefix).trim(), "there is a snapshot to clear").not.toBe("");

    // what an agent might do
    const index = join(play.folder, "site", "index.html");
    writeFileSync(index, `${readFileSync(index, "utf8")}<!-- changed -->`);
    writeFileSync(join(play.folder, "site", "new.html"), "new page");
    git(play.folder, "checkout", "-q", "-b", "extra");
    git(play.folder, "add", "-A");
    git(play.folder, "commit", "-q", "-m", "agent change");
    git(play.folder, "tag", "mark");
    writeFileSync(index, `${readFileSync(index, "utf8")}<!-- again -->`);
    git(play.folder, "stash", "-q");
    writeFileSync(index, `${readFileSync(index, "utf8")}<!-- more -->`);
    writeFileSync(join(play.folder, ".git", "index.lock"), "");

    await type(play, "reset", DONE);
    expect(git(play.folder, "status", "--short"), "nothing left over").toBe("");
    expect(git(play.folder, "rev-parse", "--abbrev-ref", "HEAD").trim()).toBe("main");
    expect(git(play.folder, "rev-parse", "HEAD").trim()).toBe(first);
    expect(git(play.folder, "for-each-ref", "--format=%(refname)").trim(), "only the first branch is left").toBe("refs/heads/main");
    expect(git(play.folder, "stash", "list")).toBe("");
    expect(existsSync(join(play.folder, "site", "new.html"))).toBe(false);
    expect(existsSync(join(play.folder, ".claude", "skills", brand.cli, "SKILL.md")), "the skill is kept").toBe(true);
    expect(await threadLines(play.folder)).toHaveLength(0);
    expect(readConfig(play.folder), "same port and token").toBe(config);
    expect((await fetch(`${play.daemon}/health`)).status).toBe(200);

    // the page that was already open: its pin goes away and a new comment still works
    await expect(page.locator(".tb-pin")).toHaveCount(0, { timeout: 15000 });
    await postComment(page, "h1", "after the reset");
    expect(await threadLines(play.folder)).toHaveLength(1);

    // twice in a row
    await type(play, "r", DONE);
    await type(play, "reset", DONE);
    expect(await threadLines(play.folder)).toHaveLength(0);
    expect(repoStatus(), "this repo's git status").toBe(repoBefore);
    await stop(play);
  } finally {
    if (play.child.exitCode === null) play.child.kill("SIGKILL");
    await browser.close();
  }
});

test("reset works with a dead daemon and a merge in progress; other words change nothing; a replaced folder is refused", async () => {
  test.setTimeout(150000);
  const repoBefore = repoStatus();
  const play = await startPlayground();
  const temp = realpathSync(mkdtempSync(join(tmpdir(), "reset-e2e-")));
  try {
    const first = git(play.folder, "rev-parse", "HEAD").trim();
    const index = join(play.folder, "site", "index.html");
    const original = readFileSync(index, "utf8");

    // another word only reminds
    await type(play, "hello", 'Type "reset"');
    expect(play.output()).not.toContain(DONE);

    // a merge with a conflict, and the daemon killed by its process id
    git(play.folder, "checkout", "-q", "-b", "other");
    writeFileSync(index, `${original}one`);
    git(play.folder, "commit", "-q", "-am", "one");
    git(play.folder, "checkout", "-q", "main");
    writeFileSync(index, `${original}two`);
    git(play.folder, "commit", "-q", "-am", "two");
    expect(() => git(play.folder, "merge", "-q", "other")).toThrow();
    expect(existsSync(join(play.folder, ".git", "MERGE_HEAD"))).toBe(true);
    const port = new URL(play.daemon).port;
    for (const pid of execFileSync("lsof", ["-ti", `tcp:${port}`, "-sTCP:LISTEN"], { encoding: "utf8" }).trim().split("\n")) process.kill(Number(pid), "SIGKILL");
    await expect.poll(() => gone(play.daemon)).toBe(true);

    await type(play, "reset", DONE);
    expect(git(play.folder, "status", "--short")).toBe("");
    expect(git(play.folder, "rev-parse", "HEAD").trim()).toBe(first);
    expect(existsSync(join(play.folder, ".git", "MERGE_HEAD"))).toBe(false);
    expect(git(play.folder, "for-each-ref", "--format=%(refname)").trim()).toBe("refs/heads/main");
    expect((await fetch(`${play.daemon}/health`)).status).toBe(200);

    // the copy folder replaced by a link to some other repo: refused, nothing changes there
    const other = join(temp, "other-repo");
    execFileSync("git", ["init", "-q", "-b", "main", other]);
    writeFileSync(join(other, "file.txt"), "x");
    execFileSync("git", ["-C", other, "add", "-A"]);
    execFileSync("git", ["-C", other, "-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-q", "-m", "one"]);
    writeFileSync(join(other, "file.txt"), "changed");
    const otherBefore = `${git(other, "status", "--short")}${git(other, "rev-parse", "HEAD")}`;
    const doneCount = play.output().split(DONE).length;
    const moved = `${play.folder}-moved`;
    renameSync(play.folder, moved);
    symlinkSync(other, play.folder);
    try {
      await type(play, "reset", "Reset not done");
      expect(play.output().split(DONE).length).toBe(doneCount);
      expect(`${git(other, "status", "--short")}${git(other, "rev-parse", "HEAD")}`).toBe(otherBefore);
    } finally {
      unlinkSync(play.folder);
      renameSync(moved, play.folder);
    }
    expect(repoStatus(), "this repo's git status").toBe(repoBefore);
    await stop(play);
  } finally {
    if (play.child.exitCode === null) play.child.kill("SIGKILL");
  }
});

const daemonPids = (daemon: string) =>
  execFileSync("lsof", ["-ti", `tcp:${new URL(daemon).port}`, "-sTCP:LISTEN"], { encoding: "utf8" }).trim().split("\n").map(Number);

test("one reset copes with a read-only folder, a stuck daemon, a rebase, a nested repo and an ignored file", async () => {
  test.setTimeout(150000);
  const repoBefore = repoStatus();
  const play = await startPlayground();
  try {
    const site = join(play.folder, "site");
    const index = join(site, "index.html");
    const original = readFileSync(index, "utf8");
    // a rebase stopped on a conflict
    git(play.folder, "checkout", "-q", "-b", "other");
    writeFileSync(index, `${original}one`);
    git(play.folder, "commit", "-q", "-am", "one");
    git(play.folder, "checkout", "-q", "main");
    writeFileSync(index, `${original}two`);
    git(play.folder, "commit", "-q", "-am", "two");
    git(play.folder, "checkout", "-q", "other");
    expect(() => git(play.folder, "rebase", "main")).toThrow();
    expect(existsSync(join(play.folder, ".git", "rebase-merge"))).toBe(true);
    // a folder nobody can write to, a nested git project, and an ignored file
    mkdirSync(join(site, "cache"));
    writeFileSync(join(site, "cache", "file.txt"), "x");
    chmodSync(join(site, "cache"), 0o555);
    mkdirSync(join(site, "nested"));
    git(join(site, "nested"), "init", "-q");
    appendFileSync(join(play.folder, ".git", "info", "exclude"), "*.cache\n");
    writeFileSync(join(site, "old.cache"), "x");
    // a folder of tracked files that nobody can write to, with an edited tracked file in it
    writeFileSync(index, `${original}edited`);
    chmodSync(site, 0o555);
    // a daemon that is stuck and will not stop when asked
    const [oldPid] = daemonPids(play.daemon);
    process.kill(oldPid!, "SIGSTOP");

    const started = Date.now();
    await type(play, "reset", DONE);
    expect(Date.now() - started, "milliseconds the reset took").toBeLessThan(15000);
    expect(() => process.kill(oldPid!, 0), "the stuck daemon is gone").toThrow();
    expect(git(play.folder, "status", "--short")).toBe("");
    expect(existsSync(join(play.folder, ".git", "rebase-merge"))).toBe(false);
    expect(readFileSync(index, "utf8"), "the tracked file is back").toBe(original);
    for (const name of ["cache", "nested", "old.cache"]) expect(existsSync(join(site, name)), name).toBe(false);
    expect((await fetch(`${play.daemon}/health`)).status).toBe(200);
    await stop(play);
    expect(repoStatus(), "this repo's git status").toBe(repoBefore);
  } finally {
    if (play.child.exitCode === null) play.child.kill("SIGKILL");
  }
});

test("two resets typed at once: one runs and the other is told to wait", async () => {
  test.setTimeout(100000);
  const play = await startPlayground();
  try {
    play.child.stdin!.write("reset\nreset\n");
    await expect.poll(() => play.output().split(DONE).length, { timeout: 40000 }).toBeGreaterThan(1);
    await new Promise((done) => setTimeout(done, 1500));
    expect(play.output().split("already running").length - 1, "told to wait").toBe(1);
    expect(play.output().split(DONE).length - 1, "resets that ran").toBe(1);
    await stop(play);
  } finally {
    if (play.child.exitCode === null) play.child.kill("SIGKILL");
  }
});

test("closing the terminal stops the daemon and the site", async () => {
  test.setTimeout(100000);
  const play = await startPlayground();
  try {
    const stopped = new Promise((done) => play.child.once("exit", done));
    play.child.kill("SIGHUP");
    await stopped;
    expect(await gone(play.daemon)).toBe(true);
    expect(await gone(play.site)).toBe(true);
  } finally {
    if (play.child.exitCode === null) play.child.kill("SIGKILL");
  }
});

test("when a reset cannot finish, the daemon still comes back on the same port", async () => {
  test.setTimeout(100000);
  const play = await startPlayground();
  try {
    // a folder where the data file belongs cannot be removed as a file, so the reset fails half way
    mkdirSync(join(play.folder, brand.dataDir, `${brand.dbFile}-stuck`));
    writeFileSync(join(play.folder, brand.dataDir, `${brand.dbFile}-stuck`, "x"), "x");
    // the daemon must already answer when the message appears, so ask in the same step as the text arrives
    let answer: Promise<number | string> | undefined;
    play.child.stdout!.on("data", (chunk) => {
      if (!answer && String(chunk).includes("Reset failed")) answer = fetch(`${play.daemon}/health`).then((r) => r.status, () => "refused");
    });
    await type(play, "reset", "Reset failed");
    expect(await answer, "the daemon answered when the message appeared").toBe(200);
    await stop(play);
  } finally {
    if (play.child.exitCode === null) play.child.kill("SIGKILL");
  }
});

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));
const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** Everything started below `parent` (children, their children and so on), found with ps. */
function startedBy(parent: number): Array<{ pid: number; command: string }> {
  const rows = execFileSync("ps", ["-axo", "pid=,ppid=,command="], { encoding: "utf8" })
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line)!)
    .map((m) => ({ pid: Number(m[1]), ppid: Number(m[2]), command: m[3]! }));
  const found: Array<{ pid: number; command: string }> = [];
  let parents = [parent];
  while (parents.length > 0) {
    const kids = rows.filter((row) => parents.includes(row.ppid));
    found.push(...kids);
    parents = kids.map((kid) => kid.pid);
  }
  return found;
}

test("closing the terminal while the playground is still starting leaves no daemon behind", async () => {
  test.setTimeout(120000);
  for (const wait of [0, 150]) {
    const child = spawn("node", [join(root, "scripts", "playground.ts")], { cwd: root, stdio: "ignore" });
    const seen = new Map<number, string>();
    const stopped = new Promise((done) => child.once("exit", done));
    try {
      // wait until the program that starts the daemon exists, which is before the playground has printed anything
      const begun = Date.now();
      while (![...seen.values()].some((command) => command.endsWith("main.ts start"))) {
        expect(child.exitCode, "the playground stopped by itself").toBeNull();
        expect(Date.now() - begun, "the daemon never started").toBeLessThan(60000);
        for (const kid of startedBy(child.pid!)) seen.set(kid.pid, kid.command);
        await sleep(5);
      }
      await sleep(wait);
      for (const kid of startedBy(child.pid!)) seen.set(kid.pid, kid.command);
      child.kill("SIGHUP");
      await stopped;
      // the daemon and the programs that start it must go too
      await expect.poll(() => [...seen.keys()].filter(alive), { timeout: 10000, message: `still running after ${wait} ms` }).toEqual([]);
    } finally {
      for (const pid of seen.keys()) if (alive(pid)) process.kill(pid, "SIGKILL");
      if (child.exitCode === null) child.kill("SIGKILL");
    }
  }
});
