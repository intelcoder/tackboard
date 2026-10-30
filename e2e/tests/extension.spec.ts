import { execFileSync, spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import type { Server } from "node:http";
import { createServer as createPortProbe } from "node:net";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { chromium, expect, test } from "@playwright/test";
import type { BrowserContext, Frame, Page } from "@playwright/test";
import { buildExtension } from "../../packages/extension/build.ts";
import { brand } from "../../packages/shared/src/brand.ts";
import { createSiteServer } from "../../scripts/playground.ts";
import { openPanel, postComment, setMode, thread } from "../fixtures/states.ts";

// The service worker's own requests are only reported to the context when this is set.
process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS = "1";

const root = join(import.meta.dirname, "..", "..");
const cli = join(root, "packages", "cli", "src", "main.ts");
const pages = join(root, "playground", "site");
const fakeHttpsSite = "https://dev.example.test";

function freePort(): Promise<number> {
  return new Promise((done, fail) => {
    const probe = createPortProbe();
    probe.once("error", fail);
    probe.listen(0, "127.0.0.1", () => {
      const port = (probe.address() as { port: number }).port;
      probe.close(() => done(port));
    });
  });
}

function listen(server: Server, port: number): Promise<Server> {
  return new Promise((done) => server.listen(port, "127.0.0.1", () => done(server)));
}

const CONTENT_TYPES: Record<string, string> = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript" };

/** The extension is built with the test sites already allowed, because Playwright cannot click Chrome's approval box. */
async function startStack(extraPermissions: string[] = []) {
  const folder = mkdtempSync(join(tmpdir(), "tb-ext-"));
  const extensionFolder = await buildExtension(join(folder, "extension"), ["http://localhost/*", fakeHttpsSite + "/*", ...extraPermissions]);
  const project = join(folder, "project");
  const daemonPort = await freePort();
  const run = (args: string[]) => execFileSync("node", [cli, ...args], { cwd: project, encoding: "utf8" });
  execFileSync("git", ["init", "-q", "-b", "main", project]);
  execFileSync("git", ["config", "user.email", "e2e@example.com"], { cwd: project });
  execFileSync("git", ["config", "user.name", "e2e"], { cwd: project });
  run(["init", "--port", String(daemonPort), "--origin", "http://localhost:1", "--user", "sam"]);
  const configText = readFileSync(join(project, brand.dataDir, brand.configFile), "utf8");

  const daemon: ChildProcess = spawn("node", [cli, "start"], { cwd: project, stdio: ["ignore", "pipe", "ignore"] });
  const servers: Server[] = [];
  let context: BrowserContext | undefined;
  const stop = async () => {
    await context?.close();
    for (const server of servers) {
      server.close();
      server.closeAllConnections();
    }
    if (daemon.exitCode === null) {
      const gone = new Promise((done) => daemon.once("exit", done));
      daemon.kill("SIGTERM");
      await gone;
    }
    rmSync(folder, { recursive: true, force: true });
  };
  try {
    await new Promise<void>((done, fail) => {
      let seen = "";
      daemon.stdout!.on("data", (d) => {
        seen += d;
        if (seen.includes("listening")) done();
      });
      daemon.once("exit", () => fail(new Error(`daemon exited early: ${seen}`)));
    });
    context = await chromium.launchPersistentContext(join(folder, "profile"), {
      channel: "chromium",
      viewport: { width: 1280, height: 800 },
      args: [`--disable-extensions-except=${extensionFolder}`, `--load-extension=${extensionFolder}`],
    });
    // A site with no network: https://dev.example.test is answered from the playground pages.
    await context.route(`${fakeHttpsSite}/**`, (route) => {
      const name = new URL(route.request().url()).pathname.replace(/^\/$/, "/index.html");
      try {
        route.fulfill({ body: readFileSync(join(pages, name)), contentType: CONTENT_TYPES[extname(name)] ?? "text/plain" });
      } catch {
        route.fulfill({ status: 404, body: "not found" });
      }
    });
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
    // Playwright hands over the worker before its script has run, so a page opened right away would fire events before the extension listens.
    await worker.evaluate(() => true);
    const extensionId = new URL(worker.url()).host;
    const site = async (scriptTag = "") => {
      const port = await freePort();
      servers.push(await listen(createSiteServer(pages, scriptTag), port));
      return `http://localhost:${port}`;
    };
    return {
      context,
      extensionId,
      daemonUrl: `http://127.0.0.1:${daemonPort}`,
      project,
      configText,
      site,
      run,
      stop,
    };
  } catch (error) {
    await stop();
    throw error;
  }
}

type Stack = Awaited<ReturnType<typeof startStack>>;

async function withStack(body: (stack: Stack) => Promise<void>, extraPermissions: string[] = []): Promise<void> {
  const stack = await startStack(extraPermissions);
  try {
    await body(stack);
  } finally {
    await stack.stop();
  }
}

async function optionsPage(stack: Stack): Promise<Page> {
  const page = await stack.context.newPage();
  await page.goto(`chrome-extension://${stack.extensionId}/options.html`);
  return page;
}

/** The setup a user does: type the site, paste the config, press Add a site. */
async function addSite(stack: Stack, options: Page, site: string): Promise<void> {
  await options.getByLabel("Site").fill(site);
  await options.getByLabel("Config").fill(stack.configText);
  await options.getByRole("button", { name: "Add a site" }).click();
  await expect(options.locator("li", { hasText: site })).toBeVisible();
}

const host = (page: Page | Frame) => page.locator(`#${brand.hostId}`);

test("the extension has the fixed id", async () => {
  await withStack(async (stack) => {
    expect(`chrome-extension://${stack.extensionId}`).toBe(brand.extensionOrigin);
  });
});

test("a site added in the options page gets the overlay with no script tag", async () => {
  await withStack(async (stack) => {
    const site = await stack.site();
    const options = await optionsPage(stack);
    await addSite(stack, options, site.replace("http://", ""));
    await expect(options.locator("li", { hasText: site }).getByLabel("On")).toBeChecked();

    const page = await stack.context.newPage();
    const asked: string[] = [];
    page.on("request", (request) => asked.push(request.url()));
    await page.goto(site);
    await expect(host(page)).toBeAttached();
    await expect(page.locator(".tb-modes")).toBeVisible();
    expect(asked.filter((url) => url.includes(brand.bundle))).toEqual([]);
  });
});

test("on an https site the overlay appears, a comment is sent through the extension, the CLI reads it and the reply comes back", async () => {
  await withStack(async (stack) => {
    const options = await optionsPage(stack);
    await addSite(stack, options, fakeHttpsSite);
    const page = await stack.context.newPage();
    await page.goto(fakeHttpsSite);
    await expect(page.locator(".tb-modes")).toBeVisible();
    const id = await postComment(page, ".hero-title", "make this bigger");

    const next = stack.run(["next"]);
    expect(next).toContain("make this bigger");
    expect(next).toContain(`page: ${fakeHttpsSite}/`);
    expect(next).toContain(`THREAD ${id}`);
    stack.run(["reply", id, "done, it is bigger"]);
    await openPanel(page);
    await expect(thread(page, id).getByText("done, it is bigger")).toBeVisible();
  });
});

test("the page never sees the token", async () => {
  await withStack(async (stack) => {
    const token = (JSON.parse(stack.configText) as { token: string }).token;
    const options = await optionsPage(stack);
    await addSite(stack, options, fakeHttpsSite);
    const page = await stack.context.newPage();
    await page.goto(fakeHttpsSite);
    await expect(page.locator(".tb-modes")).toBeVisible();
    await postComment(page, ".hero-title", "look for the token");

    const seen = await page.evaluate(
      async ([secret, global, daemon]) => {
        let found = 0;
        const scan = (node: Node) => {
          if (node.nodeType === 3 && node.textContent!.includes(secret!)) found++;
          if (node instanceof Element) {
            for (const attribute of node.attributes) if (attribute.value.includes(secret!)) found++;
            if (node.shadowRoot) node.shadowRoot.childNodes.forEach(scan);
          }
          node.childNodes.forEach(scan);
        };
        scan(document);
        const withoutToken = await fetch(`${daemon}/threads`).then((r) => r.status, () => "refused");
        const stored = [localStorage, sessionStorage].some((store) => JSON.stringify(Object.entries(store)).includes(secret!));
        return {
          found,
          stored,
          cookie: document.cookie.includes(secret!),
          globalValue: typeof (window as any)[global!],
          withoutToken,
        };
      },
      [token, brand.configGlobal, stack.daemonUrl],
    );
    expect(seen.found).toBe(0);
    expect(seen.stored).toBe(false);
    expect(seen.cookie).toBe(false);
    expect(seen.globalValue).toBe("undefined");
    expect(seen.withoutToken).toBe("refused");
  });
});

test("with the script tag too there is only one overlay, in both orders", async () => {
  await withStack(async (stack) => {
    const tagged = await stack.site(`<script src="${stack.daemonUrl}/${brand.bundle}"></script>`);
    const plain = await stack.site();
    const options = await optionsPage(stack);
    await addSite(stack, options, tagged.replace("http://", ""));
    await addSite(stack, options, plain.replace("http://", ""));

    // the tag is in the page first
    const first = await stack.context.newPage();
    await first.goto(tagged);
    await expect(host(first)).toHaveCount(1);
    await first.waitForTimeout(1000);
    await expect(host(first)).toHaveCount(1);

    // the extension's overlay shows first, then the tag is added
    const second = await stack.context.newPage();
    await second.goto(plain);
    await expect(host(second)).toBeAttached();
    await second.addScriptTag({ url: `${stack.daemonUrl}/${brand.bundle}` });
    await second.waitForTimeout(1000);
    await expect(host(second)).toHaveCount(1);
  });
});

test("turning a site off removes the overlay, on brings it back, remove deletes it", async () => {
  await withStack(async (stack) => {
    const site = await stack.site();
    const options = await optionsPage(stack);
    await addSite(stack, options, site.replace("http://", ""));
    const page = await stack.context.newPage();
    await page.goto(site);
    await expect(host(page)).toBeAttached();

    const daemonCalls: string[] = [];
    stack.context.on("request", (request) => {
      if (request.url().startsWith(stack.daemonUrl)) daemonCalls.push(request.url());
    });
    await expect.poll(() => daemonCalls.length, "the overlay asks the daemon while on").toBeGreaterThan(0);
    const row = options.locator("li", { hasText: site });
    await row.getByLabel("On").uncheck();
    await expect(host(page)).toHaveCount(0);
    await page.waitForTimeout(500);
    const callsWhenOff = daemonCalls.length;
    await page.waitForTimeout(3500);
    expect(daemonCalls.length).toBe(callsWhenOff);

    await row.getByLabel("On").check();
    await expect(host(page)).toBeAttached();

    await row.getByRole("button", { name: "Remove" }).click();
    await expect(options.locator("li", { hasText: site })).toHaveCount(0);
    // the tab that was open when the site was removed keeps its overlay, and says why a comment cannot be sent
    await page.locator('.tb-modes [data-mode="comment"]').click();
    await page.hover(".hero-title");
    await page.click(".hero-title");
    await page.locator('[data-key="composer"]').fill("sent after the site was removed");
    await page.locator('[data-key="send"]').click();
    await expect(page.getByText("This site is not turned on in the extension")).toBeVisible();
    const again = await stack.context.newPage();
    await again.goto(site);
    await again.waitForTimeout(1500);
    await expect(host(again)).toHaveCount(0);
  });
});

test("a site that was not added gets no overlay", async () => {
  await withStack(async (stack) => {
    const added = await stack.site();
    const other = await stack.site();
    const options = await optionsPage(stack);
    await addSite(stack, options, added.replace("http://", ""));
    // the same host name with another port: the content script runs there, but the site is not on
    const otherPort = await stack.context.newPage();
    await otherPort.goto(other);
    await otherPort.waitForTimeout(1500);
    await expect(host(otherPort)).toHaveCount(0);
    const address = await stack.context.newPage();
    await address.goto(other.replace("localhost", "127.0.0.1"));
    await address.waitForTimeout(1500);
    await expect(host(address)).toHaveCount(0);
  });
});

const savedScripts = (options: Page) =>
  options.evaluate(async () => (await (globalThis as any).chrome.scripting.getRegisteredContentScripts()) as { id: string; allFrames?: boolean }[]);
const registeredScripts = async (options: Page) => (await savedScripts(options)).map((script) => script.id);

/** Adds a page of the site inside the page as an iframe, and gives back that frame once it has loaded. */
async function addFrame(page: Page, address: string): Promise<Frame> {
  await page.evaluate(
    (src) =>
      new Promise<void>((done) => {
        const frame = document.createElement("iframe");
        frame.onload = () => done();
        frame.src = src;
        document.body.append(frame);
      }),
    address,
  );
  return page.frames().find((frame) => frame.url() === address)!;
}

test("Remove unregisters the script only when no other site uses the same pattern", async () => {
  await withStack(async (stack) => {
    const first = await stack.site();
    const second = await stack.site();
    const options = await optionsPage(stack);
    await addSite(stack, options, first.replace("http://", ""));
    await addSite(stack, options, second.replace("http://", ""));
    await addSite(stack, options, fakeHttpsSite);
    const open = await stack.context.newPage();
    await open.goto(second);
    await expect.poll(async () => (await badgeOn(stack, open)).text).toBe("ON");
    expect((await registeredScripts(options)).sort()).toEqual(["http://localhost/*", `${fakeHttpsSite}/*`]);

    await options.locator("li", { hasText: first }).getByRole("button", { name: "Remove" }).click();
    await expect(options.locator("li", { hasText: first })).toHaveCount(0);
    expect(await registeredScripts(options)).toContain("http://localhost/*");

    await options.locator("li", { hasText: second }).getByRole("button", { name: "Remove" }).click();
    await expect(options.locator("li", { hasText: second })).toHaveCount(0);
    await expect.poll(() => registeredScripts(options)).toEqual([`${fakeHttpsSite}/*`]);
    // the tab still open on the removed site loses its badge
    await expect.poll(async () => (await badgeOn(stack, open)).text).toBe("");
  });
});

test("when Chrome refuses to register the script, nothing is saved and one plain line shows", async () => {
  await withStack(async (stack) => {
    const options = await optionsPage(stack);
    await options.evaluate(() => {
      (globalThis as any).chrome.scripting.registerContentScripts = () => Promise.reject(new Error("no"));
    });
    await options.getByLabel("Site").fill(fakeHttpsSite);
    await options.getByLabel("Config").fill(stack.configText);
    await options.getByRole("button", { name: "Add a site" }).click();
    await expect(options.locator("#problem")).toHaveText(/^Chrome did not allow that site \(.*no.*\)$/);
    await expect(options.locator("#sites")).toHaveText("No sites yet.");
    expect(await savedScripts(options)).toEqual([]);
    expect(await options.evaluate(async () => (await (globalThis as any).chrome.storage.local.get("sites")).sites)).toBeUndefined();
  });
});

/** Playwright cannot press the real toolbar button, so this raises the same event the button raises. `tab` is a page of the context, or just an address. */
async function clickToolbar(stack: Stack, tab: Page | { url: string }): Promise<void> {
  const worker = stack.context.serviceWorkers()[0]!;
  const address = typeof tab.url === "function" ? tab.url() : tab.url;
  await worker.evaluate(async (wanted) => {
    const chrome = (globalThis as any).chrome;
    const found = ((await chrome.tabs.query({})) as { url?: string }[]).find((one) => one.url === wanted);
    chrome.action.onClicked.dispatch(found ?? { url: wanted });
  }, address);
}

/** The button's words and hover title on the tab that shows this page. */
async function badgeOn(stack: Stack, page: Page): Promise<{ text: string; title: string; textColor: number[] }> {
  const worker = stack.context.serviceWorkers()[0]!;
  return worker.evaluate(async (wanted) => {
    const chrome = (globalThis as any).chrome;
    const tab = ((await chrome.tabs.query({})) as { id: number; url?: string }[]).find((one) => one.url === wanted)!;
    return { text: await chrome.action.getBadgeText({ tabId: tab.id }), title: await chrome.action.getTitle({ tabId: tab.id }), textColor: await chrome.action.getBadgeTextColor({ tabId: tab.id }) };
  }, page.url());
}

/** The button's hover title on the tab in front. */
async function titleOfFrontTab(stack: Stack): Promise<string> {
  return stack.context.serviceWorkers()[0]!.evaluate(async () => {
    const chrome = (globalThis as any).chrome;
    const [tab] = (await chrome.tabs.query({ active: true })) as { id: number }[];
    return chrome.action.getTitle({ tabId: tab!.id }) as Promise<string>;
  });
}

test("the toolbar click turns a site off and on with no reload, and the badge follows", async () => {
  await withStack(async (stack) => {
    const site = await stack.site();
    const notAdded = await stack.site();
    const options = await optionsPage(stack);
    await addSite(stack, options, site.replace("http://", ""));
    const page = await stack.context.newPage();
    await page.goto(site);
    await expect(host(page)).toBeAttached();
    await page.evaluate(() => ((window as any).marker = 1));
    await expect.poll(async () => (await badgeOn(stack, page)).text).toBe("ON");

    const daemonCalls: string[] = [];
    stack.context.on("request", (request) => {
      if (request.url().startsWith(stack.daemonUrl)) daemonCalls.push(request.url());
    });
    await clickToolbar(stack, page);
    await expect(host(page)).toHaveCount(0);
    await expect.poll(async () => (await badgeOn(stack, page)).text).toBe("OFF");
    expect((await badgeOn(stack, page)).title).toContain("off for this site");
    expect((await badgeOn(stack, page)).textColor).toEqual([255, 255, 255, 255]);
    expect(await page.evaluate(() => (window as any).marker)).toBe(1);
    await page.waitForTimeout(500);
    const callsWhenOff = daemonCalls.length;
    await page.waitForTimeout(3500);
    expect(daemonCalls.length).toBe(callsWhenOff);

    await clickToolbar(stack, page);
    await expect(host(page)).toBeAttached();
    await expect.poll(async () => (await badgeOn(stack, page)).text).toBe("ON");
    expect((await badgeOn(stack, page)).textColor).toEqual([255, 255, 255, 255]);
    expect(await page.evaluate(() => (window as any).marker)).toBe(1);

    await page.goto(notAdded);
    await expect.poll(async () => (await badgeOn(stack, page)).text).toBe("");
  });
});

test("a toolbar click on a page that was not added opens the options page with the site filled in", async () => {
  await withStack(async (stack) => {
    const site = await stack.site();
    const page = await stack.context.newPage();
    await page.goto(site);
    await expect.poll(async () => (await badgeOn(stack, page)).title).toContain("add this site");
    const opened = stack.context.waitForEvent("page");
    await clickToolbar(stack, page);
    const options = await opened;
    await options.waitForLoadState();
    expect(options.url()).toBe(`chrome-extension://${stack.extensionId}/options.html?site=${encodeURIComponent(site)}`);
    await expect(options.getByLabel("Site")).toHaveValue(site);
    await expect(options.getByLabel("Config")).toBeFocused();

    // the text is only ever a value, never markup
    const hostile = '"><img src=x onerror="window.__pwn=1">';
    const careful = await stack.context.newPage();
    await careful.goto(`chrome-extension://${stack.extensionId}/options.html?site=${encodeURIComponent(hostile)}`);
    await expect(careful.getByLabel("Site")).toHaveValue(hostile);
    expect(await careful.locator("img").count()).toBe(0);
    expect(await careful.evaluate(() => (window as any).__pwn)).toBeUndefined();
    await careful.close();

    await options.getByLabel("Config").fill(stack.configText);
    await options.getByRole("button", { name: "Add a site" }).click();
    await expect(options.locator("li", { hasText: site }).getByLabel("On")).toBeChecked();
    await page.reload();
    await expect(host(page)).toBeAttached();
  });
});

test("a toolbar click on a page that is not http or https opens the options page with the Site box empty", async () => {
  await withStack(async (stack) => {
    // Chrome hides the address of these tabs from the extension, so the tab is found by being the one in front. A tab that never had a page keeps the plain button title, so each one comes from a web page first.
    for (const address of ["about:blank", "chrome://version"]) {
      const tab = await stack.context.newPage();
      await tab.goto(await stack.site());
      await tab.goto(address);
      await tab.bringToFront();
      await expect.poll(() => titleOfFrontTab(stack), address).toContain("click to open the site list");
      expect(await titleOfFrontTab(stack)).not.toContain("add this site");
    }
    for (const url of ["about:blank", "chrome://version"]) {
      const opened = stack.context.waitForEvent("page");
      await clickToolbar(stack, { url });
      const options = await opened;
      await options.waitForLoadState();
      expect(options.url()).toBe(`chrome-extension://${stack.extensionId}/options.html`);
      await expect(options.getByLabel("Site")).toHaveValue("");
      await expect(options.locator("#sites")).toHaveText("No sites yet.");
    }
  });
});

test("the toolbar button is registered and has no popup", async () => {
  await withStack(async (stack) => {
    const seen = await stack.context.serviceWorkers()[0]!.evaluate(() => {
      const chrome = (globalThis as any).chrome;
      return { listening: chrome.action.onClicked.hasListeners() as boolean, popup: chrome.runtime.getManifest().action.default_popup as string | undefined };
    });
    expect(seen).toEqual({ listening: true, popup: undefined });
  });
});

test("adding a site registers one script for all frames, also when the site is added twice", async () => {
  await withStack(async (stack) => {
    const options = await optionsPage(stack);
    for (let time = 0; time < 2; time++) {
      await options.getByLabel("Site").fill(fakeHttpsSite);
      await options.getByLabel("Config").fill(stack.configText);
      await options.getByRole("button", { name: "Add a site" }).click();
      await expect(options.getByLabel("Site")).toHaveValue("");
      await expect(options.locator("#problem")).toHaveText("");
      expect(await savedScripts(options)).toMatchObject([{ id: `${fakeHttpsSite}/*`, allFrames: true }]);
    }
  });
});

test("the overlay appears in a frame of the same host, never twice in one frame, and the token cannot be read from the frame", async () => {
  await withStack(async (stack) => {
    const token = (JSON.parse(stack.configText) as { token: string }).token;
    const site = await stack.site();
    const options = await optionsPage(stack);
    await addSite(stack, options, site.replace("http://", ""));
    const page = await stack.context.newPage();
    await page.goto(site);
    await expect(host(page)).toBeAttached();
    const frame = await addFrame(page, `${site}/order.html`);
    await expect(host(frame)).toBeAttached();
    await page.waitForTimeout(1000);
    await expect(host(frame)).toHaveCount(1);

    const seen = await frame.evaluate(
      ([secret, global]) => {
        let found = 0;
        const scan = (node: Node) => {
          if (node.nodeType === 3 && node.textContent!.includes(secret!)) found++;
          if (node instanceof Element) {
            for (const attribute of node.attributes) if (attribute.value.includes(secret!)) found++;
            if (node.shadowRoot) node.shadowRoot.childNodes.forEach(scan);
          }
          node.childNodes.forEach(scan);
        };
        scan(document);
        const stored = [localStorage, sessionStorage].some((store) => JSON.stringify(Object.entries(store)).includes(secret!));
        return { found, stored, cookie: document.cookie.includes(secret!), globalValue: typeof (window as any)[global!] };
      },
      [token, brand.configGlobal],
    );
    expect(seen).toEqual({ found: 0, stored: false, cookie: false, globalValue: "undefined" });
  });
});

test("a frame from another host inside an added page gets no overlay, and the daemon refuses its own fetch", async () => {
  await withStack(async (stack) => {
    const site = await stack.site();
    const options = await optionsPage(stack);
    await addSite(stack, options, site.replace("http://", ""));
    const page = await stack.context.newPage();
    await page.goto(site);
    await expect(host(page)).toBeAttached();
    // this host is allowed in the build, but it was not added
    const frame = await addFrame(page, `${fakeHttpsSite}/`);
    await page.waitForTimeout(1500);
    await expect(host(frame)).toHaveCount(0);
    expect(await frame.evaluate((daemon) => fetch(`${daemon}/threads`).then((r) => r.status, () => "refused"), stack.daemonUrl)).toBe("refused");
  });
});

test("a frame of an added host inside a page of a host that was not added shows no overlay and reaches no daemon", async () => {
  await withStack(async (stack) => {
    const site = await stack.site();
    const options = await optionsPage(stack);
    await addSite(stack, options, site.replace("http://", ""));
    // the same machine under another name, so this page is not an added site
    const page = await stack.context.newPage();
    await page.goto(site.replace("localhost", "127.0.0.1"));
    await expect(host(page)).toHaveCount(0);
    const frame = await addFrame(page, `${site}/`);
    await page.waitForTimeout(1500);
    await expect(host(frame)).toHaveCount(0);
    await expect(host(page)).toHaveCount(0);
  });
});

/** Opens the options page for a site, with the clipboard read replaced so the test decides what the clipboard holds. `answer` is code that runs in the page. */
async function optionsWithClipboard(stack: Stack, answer: string): Promise<Page> {
  const page = await stack.context.newPage();
  await page.addInitScript(`window.__reads = 0; navigator.clipboard.readText = () => { window.__reads++; return ${answer}; };`);
  await page.goto(`chrome-extension://${stack.extensionId}/options.html?site=${encodeURIComponent("http://localhost:1")}`);
  await expect.poll(() => page.evaluate(() => (window as any).__reads)).toBe(1);
  return page;
}

/** A short wait, so the answer of the clipboard read has been used before the test looks. */
const settle = (page: Page) => page.evaluate(() => new Promise((done) => setTimeout(done, 200)));

test("with a config on the clipboard the Config box fills when the page opens with ?site=, and typed text is not overwritten", async () => {
  await withStack(async (stack) => {
    const filled = await optionsWithClipboard(stack, `Promise.resolve(${JSON.stringify(stack.configText)})`);
    await expect(filled.getByLabel("Config")).toHaveValue(stack.configText);

    // the clipboard answers only after the user has typed
    const late = await optionsWithClipboard(stack, `new Promise((done) => (window.__answer = () => done(${JSON.stringify(stack.configText)})))`);
    await late.getByLabel("Config").fill("typed by hand");
    await late.evaluate(() => (window as any).__answer());
    await settle(late);
    await expect(late.getByLabel("Config")).toHaveValue("typed by hand");
  });
});

test("the Config box stays empty for text that is not a config, for an empty clipboard and for a clipboard read that fails", async () => {
  await withStack(async (stack) => {
    for (const answer of ['Promise.resolve("just some words")', 'Promise.resolve("")', 'Promise.reject(new Error("no"))']) {
      const page = await optionsWithClipboard(stack, answer);
      await settle(page);
      await expect(page.getByLabel("Config")).toHaveValue("");
      await expect(page.locator("#problem")).toHaveText("");
    }
  });
});

test("removing a site whose script was already unregistered still removes the site", async () => {
  await withStack(async (stack) => {
    const options = await optionsPage(stack);
    const errors: Error[] = [];
    // The test build grants the site for good, and Chrome refuses to take such a permission back, so that one error is expected here.
    options.on("pageerror", (error) => error.message !== "You cannot remove required permissions." && errors.push(error));
    await addSite(stack, options, fakeHttpsSite);
    await options.evaluate(async (pattern) => (globalThis as any).chrome.scripting.unregisterContentScripts({ ids: [pattern] }), `${fakeHttpsSite}/*`);
    expect(await savedScripts(options)).toEqual([]);

    await options.locator("li", { hasText: fakeHttpsSite }).getByRole("button", { name: "Remove" }).click();
    await expect(options.locator("#sites")).toHaveText("No sites yet.");
    await options.waitForTimeout(500);
    expect(await options.evaluate(async () => (await (globalThis as any).chrome.storage.local.get("sites")).sites)).toEqual({});
    expect(errors).toEqual([]);
  });
});

test("frames with srcdoc, about:blank, data: or blob: addresses inside an added page get no overlay", async () => {
  await withStack(async (stack) => {
    const site = await stack.site();
    const options = await optionsPage(stack);
    await addSite(stack, options, site.replace("http://", ""));
    const page = await stack.context.newPage();
    await page.goto(site);
    await expect(host(page)).toBeAttached();
    // a same-host frame shows the extension is working in frames at all
    const same = await addFrame(page, `${site}/order.html`);
    await expect(host(same)).toBeAttached();

    await page.evaluate(
      () =>
        Promise.all(
          ["srcdoc", "about:blank", "data:text/html,<p>data</p>", URL.createObjectURL(new Blob(["<p>blob</p>"], { type: "text/html" }))].map(
            (address, index) =>
              new Promise<void>((done) => {
                const frame = document.createElement("iframe");
                frame.onload = () => done();
                if (index === 0) frame.srcdoc = "<p>srcdoc</p>";
                else frame.src = address;
                document.body.append(frame);
              }),
          ),
        ),
    );
    await page.waitForTimeout(1500);
    const others = page.frames().filter((frame) => frame !== page.mainFrame() && frame !== same);
    expect(others).toHaveLength(4);
    for (const frame of others) await expect(host(frame), frame.url()).toHaveCount(0);
  });
});

test("the clipboard is not read when the options page opens without ?site=", async () => {
  await withStack(async (stack) => {
    const page = await stack.context.newPage();
    await page.addInitScript(`window.__reads = 0; navigator.clipboard.readText = () => { window.__reads++; return Promise.resolve(${JSON.stringify(stack.configText)}); };`);
    await page.goto(`chrome-extension://${stack.extensionId}/options.html`);
    await expect(page.locator("#sites")).toHaveText("No sites yet.");
    await settle(page);
    expect(await page.evaluate(() => (window as any).__reads)).toBe(0);
    await expect(page.getByLabel("Config")).toHaveValue("");
  });
});

test("a ticked Attach screenshot box sends a picture of just that element, with no overlay in it; unticked sends none", async () => {
  await withStack(async (stack) => {
    const options = await optionsPage(stack);
    await addSite(stack, options, fakeHttpsSite);
    const page = await stack.context.newPage();
    await page.goto(fakeHttpsSite);
    await expect(page.locator(".tb-modes")).toBeVisible();

    const pick = async (selector: string) => {
      await setMode(page, "comment");
      await page.hover(selector);
      await page.click(selector);
      await page.locator('[data-key="composer"]').fill("too tight");
    };
    await pick(".hero-title");
    await expect(page.locator('[data-key="attach-shot"]')).not.toBeChecked();
    await page.locator('[data-key="attach-shot"]').check();
    await page.locator('[data-key="send"]').click();
    await page.locator(".tb-thread.active").waitFor();
    const box = (await page.locator(".hero-title").boundingBox())!;

    const next = stack.run(["next"]);
    const path = /screenshot: (\S+\.png)/.exec(next)?.[1];
    expect(path).toMatch(/^\.tackboard\/shots\/.+\.png$/);
    const png = readFileSync(join(stack.project, path!));
    expect(png.subarray(1, 4).toString()).toBe("PNG");
    // The size is in the PNG header: width then height, 4 bytes each, at byte 16.
    expect(Math.abs(png.readUInt32BE(16) - box.width)).toBeLessThanOrEqual(2);
    expect(Math.abs(png.readUInt32BE(20) - box.height)).toBeLessThanOrEqual(2);
    // The overlay was put back after the picture.
    await expect(host(page)).toBeVisible();

    await pick(".hero-title");
    await page.locator('[data-key="send"]').click();
    await page.locator(".tb-thread.active").waitFor();
    expect(stack.run(["next"])).not.toContain("screenshot:");
    // Chrome's approval box cannot be clicked by a test, so this build already holds <all_urls>.
  }, ["<all_urls>"]);
});
