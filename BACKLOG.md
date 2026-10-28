# Backlog

Things that were found, decided against for now, or left open when v1 was wrapped up. Nothing here blocks using the tool. Each item says where to look and, where it matters, how it was found. Pick one, check it is still true, and delete it from this file when it is done.

Priority: **P1** can lose or confuse a user's data or work. **P2** is a visible rough edge. **P3** is cosmetic or an idea.

## Not verified at wrap-up

- **P1: the last full check was not finished.** The final gate was run in rounds. In the last round one reviewer passed (280 unit tests, 132 browser tests, a real Claude Code session) and the second, adversarial one was stopped before it returned. These were not repeated in that round: 100 refused agent resolves, queue attacks while sampling the item labels, performance and memory stress on a 40 000-element page, margin/padding/gap strips on odd elements, `init` and skill-copy edge cases, and the security checks. Each fix since the previous round was verified on its own, and so were the later features (drafts and Send all, the new comment box layout, the plain-names rename), but no full two-reviewer round has run over them. Run the full checks again before publishing a release.
- **P2: Cursor is untested.** The README says so. Cursor's docs say it reads `.claude/skills/`, but nobody has run it. If the skill is not picked up, have `tackboard init` also write one `.cursor/rules/tackboard.mdc` (frontmatter `alwaysApply: true`). Also untested there: a blocking `tackboard wait` of up to 60 seconds, and whether Cursor's sandbox lets the agent reach `127.0.0.1`.
- **P3: the "Comment N resolved" toast after your own Resolve click** was not seen by one reviewer (the green pin and the Resolved tab were right). It is built from poll changes, so it may not fire for the user's own click. Check `packages/overlay/src/toast.ts`.

## Daemon and API

- **P2: no limit on `url`, `element.tag` and `element.component`** in a posted comment (only `html`, `selector` and `text` are capped). Anyone with the token can make the agent's output large. `packages/daemon/src/interface/http.ts`, `packages/shared/src/api.ts`.
- **P2: the thread list is heavy at large sizes.** Each poll runs three `git` child processes (about 37 ms with no threads) and sends every thread with its `html` (22 MB per poll at 5 000 threads, about 0.5 s of daemon stall). Ideas: cache the branch, leave `html` out of list rows, `ETag` or a `since` parameter. `packages/daemon/src/application/queries/list_threads.ts`, `infrastructure/git_info.ts`.
- **P3: no poll backoff** when the daemon is down, and no pause for a hidden tab (the overlay polls every 1.5 s while any mode other than hidden is on).
- **P3: `HEAD` on the token-free paths returns 401**, where `GET` is the only open method. Harmless, and not covered by a test.
- **P3: a refused agent resolve and an already-resolved thread** now answer 409 `waiting_on_user`, not 400. The code name no longer describes the reason; the message does.
- **P3: agent-started comments** (`tackboard comment`) are stored with an empty page address and an empty tag. The overlay treats an empty address as "any page" and an empty tag as "any element". Recording the real page would be cleaner.

## Overlay

- **P2: a retried send can be stored twice.** After "The daemon did not answer" the message may already have arrived, and Retry then posts it again. The README says so. A fix needs an id the daemon can recognise (an idempotency key); it was left out to keep the change small.
- **P2: the send queue and the drafts live in the page.** Both are lost on reload. No persistence by design; drafts kept in the daemon would survive a reload but add a draft state to threads, the API and the CLI.
- **P3: drafts are minimal.** They show only in the panel (no pins on the page), cannot be edited (remove and add again), and Send all creates one ordinary thread per draft. The agent may start on the first before the last has arrived. A batch id on the threads, so the agent takes them as one task, would need a daemon change. After Send all the panel switches to View mode and opens the last thread, which interrupts a batch flow.
- **P2: Resolve (and the reply box) can need a scroll in the short panel**, for example with the notification banner showing and a long thread. A sticky action row would fix it.
- **P3: the margin, padding and gap strips** are drawn outside a scroll container for an element partly scrolled out of it, are wrong for `transform: scale()` (they use CSS pixels around the scaled box), and show vertical margins on inline elements. On macOS holding Control then clicking opens the browser's context menu, so release Control before picking. `packages/overlay/src/spacing.ts`.
- **P3: two comments on the same element** put their pins at the same spot; one covers the other. Both are reachable from the panel.
- **P3: a pin can linger for up to one poll (1.5 s)** after its element leaves the page, and a text-matched element keeps its pin if its text changes in place.
- **P3: threads from other pages** are listed under "Element missing" in the panel.
- **P3: queue details:** a queued reply is hidden when another thread becomes the active one; Retry and Remove sit partly clipped at the bottom of the list until you scroll; two stacked "Cannot reach the daemon" banners can appear.
- **P3: dark-mode contrast:** white text on the amber and green fills measures about 1.9:1.
- **P3: restore marker and banner:** the restore marker reads "after message 1·" (the space collapses and the hash is cut), and the blocked-notification banner's Dismiss button wraps onto its own line at 320 and 390 px.
- **P3: `destroy()` aborting an in-flight send** and clearing a held Control key have no tests.

## CLI and docs

- **P3: small CLI rough edges:** `wait --timeout -1` prints a raw argument error; `--mention you` is silently ignored; `--port 1e3` and `0x10` are accepted as ports; a corrupt `.tackboard/config.json` gives a raw parse error; the restore notice shows raw ids ("message t3/m1") where the panel says "message 1"; when `SKILL.md` is a directory, `init` says "left as is"; the usage line for `channel` is not pinned by any test.
- **P3: the skill and the README repeat the loop, the "only the user closes a thread" rule and the worktree explanation.** A test checks the command names only, so the copies can drift apart.
- **P3: `tackboard` is not on your PATH** until you run `npm link -w packages/cli`; the package is private and not published. Publishing (a built CLI, a versioned overlay file) is not done.

## Claude Code channel

- **P2: channels are a research preview.** The start flag (`--dangerously-load-development-channels`) and the dialogs may change, and they need claude.ai or Console login (not Bedrock, Vertex or Foundry) and, on Team and Enterprise, an owner switch. Re-check https://code.claude.com/docs/en/channels.md when upgrading Claude Code. The server answers protocol versions up to 2025-11-25; the docs describe `MCP_PROTOCOL_NEGOTIATION=legacy` for the newer revision.
- **P3: the channel only works in an interactive session** (the docs say the flag is ignored with `-p`).
- **P3: a comment is delivered once** only until its claim goes stale (30 minutes); then it can be claimed and sent again.
- **P3: idea, tools for the agent.** A channel with tools (reply, comment) instead of shell commands. Not needed: the CLI works with every agent.
- **P3: idea, WebSocket or Server-Sent Events** between the daemon and the page instead of polling. Browsers cannot set a header on either, so the token would have to move into the URL or a first message. Left out because the page cost was the real problem, and that is fixed.

## Playground

- **P3: a hard link to an outside file is served.** The playground server serves only `<copy>/site/` and checks the real path of every file, which closes every symlink case, but a hard link (`ln`, not `ln -s`) made inside `site/` to a file elsewhere on the same disk (for example the daemon's token file) looks like an ordinary file and is served. Only an agent working in the throwaway copy can make one. The daemon also gives the token to any allowed page in its own bundle, by design.

- **P3: playground tests leave the daemon behind when they fail.** The `finally` blocks of most tests in `e2e/tests/playground.spec.ts` stop only the playground, and the daemon runs in its own process group, so a failing test leaves a daemon running (passing runs are clean). The SIGHUP test already records and kills its own pids; the others could do the same.
- **P3: `SIGKILL` of the playground** leaves its daemon running (no program can handle it). Stop it with Ctrl+C, SIGTERM or SIGHUP.
- **P3: SIGTERM during a reset** can still print the done line although the daemon is deliberately not restarted while leaving.

## Chrome extension

- **P2: not run by hand in real Chrome.** The agent could only drive Playwright's Chromium. Never seen in real Chrome: the approval box from `permissions.request`; a real `permissions.remove` after Remove; dark mode of the options page; the options page error lines; the Chrome screens the README names (`chrome://extensions`, Load unpacked, Details, Extension options, the reload arrow), which are written from Chrome's documented behaviour. The e2e builds the extension with the test sites already approved (`extraHostPermissions` in `packages/extension/build.ts`). With the plain build (`packages/extension/dist/`) in Playwright's Chromium, `Add a site` saved nothing and showed no line for 6 seconds, because nobody could answer the box. Before a release, add a site by hand in Chrome, then Remove it, and look at `chrome://extensions` for the site access.
- **P2: the click's user gesture may not survive the `await permissions.contains`** that runs before `permissions.request` (`packages/extension/src/options.ts`, the submit handler). If Chrome then refuses the request for lack of a gesture, every add shows `Chrome did not allow that site`. Not seen in real Chrome.
- **P3: the undo branch is not tested.** `if (!hadIt) ...permissions.remove` after a failed registration (`options.ts`) cannot be reached by a test under the pre-approved build. The e2e proves the failure itself with a stub of `registerContentScripts` (`e2e/tests/extension.spec.ts`, last test).
- **P3: a `null` entry in the saved sites crashes the options page** (`showSites` in `options.ts` reads `sites[origin]!.on`). Only this extension writes that key, so it needs a bug or a hand edit to happen.
- **P3: an unknown or malformed message from the content-script side gets no reply** (`packages/extension/src/proxy.ts`, `background.ts`). A web page cannot send one, because pages have no way to message the extension; the cost is a call that waits.
- **P3: `removeSite` throws if the script was already unregistered**, so the permission removal after it is skipped (`options.ts`, `unregisterContentScripts` before `permissions.remove`). The site is already gone from the list by then.
- **P3: Chrome Web Store publishing is not done.** A store build gets its own id, so `brand.extensionOrigin` (`packages/shared/src/brand.ts`) would have to list two origins, and `packages/daemon/src/interface/http.ts` allows only one.
- **P3: Firefox and Safari are not supported** (the manifest and `chrome.*` calls are Chrome's).
- **P3: no settings sync, import or export** of the site list; the sites and the token live in `chrome.storage.local` of one profile (`packages/extension/src/chrome_calls.ts`).
- **P3: no per-page rules.** The choice is per site address, so one page of a site cannot be left out.
- **P3: React component names are lost in the extension.** A content script's separate JavaScript world cannot see React's data on elements (`packages/overlay/src/source_map.ts` line 19, `Object.keys(el)`). From Chrome's documented rule; not measured in a real page. The `data-tb-src` attribute route is read with `getAttribute`.
- **P3: Chrome's approval is per host name and ignores the port.** `permissions.request` patterns have no port (`siteFrom` in `packages/extension/src/sites.ts`), so one approval covers every port of that host. The bar still shows only on the saved address.
- **P3: no icon, popup or toolbar button** (`packages/extension/build.ts` has no `action`); the options page is reached through `chrome://extensions`.
- **P3: the content script is loaded on every page of an added host** and asks the background once whether the site is on (`packages/extension/src/content.ts`, `background.ts`), including other ports of the same host.
- **P3: the local-network prompt is untested.** The README says Chrome's newer local-network permission prompt may block the script tag route on a public `https` domain; the extension route was the only one tried.

## Names (the rule: easy everyday words, no jargon)

- **P3: names left after the plain-names pass.** Kept on purpose: `h`, `H` and `createH` (`h` is also a height in many places, so a blind rename is unsafe), the CSS classes `tb-crumbs` and `tb-convo` (browser tests select them), the `job` field on queue items. Cryptic names a reviewer still found, with a plainer one: `crumbs2` and `chain` (hover.ts) -> `parents`, `kept` and `finder` (element_ref.ts) -> `foundElements`, `snap`, `lit`, `lastLook`, `settle`, `poller` in tests and helpers -> `savedState`, `highlighted`, `lastSeen`, `waitUntilStill`, `pollTimer`, `evil` and `fakeSend` and `withStub` in tests -> `badInput`, `pretendSend`, `withFakeDaemon`, `px` -> `pixels`, and the `box` variable in `thread_view.test.ts` -> `replyBox`. The `fiber` names in `source_map.ts` are React's own word and may stay.

## How the work was checked (for whoever continues)

- Unit: `npm test`. Browser: `npm run test:e2e` (builds first, real Chromium, no retries). Guard: `node scripts/guard.ts`. Type check: `npm run typecheck`.
- Performance: the stress scripts used for the investigation are not in the repo. The numbers worth keeping: on a 20 000-element page with 30 unmatched comments a scroll event should stay under 10 ms and idle CPU under about 100 ms per 10 s (`e2e/tests/large_page.spec.ts` asserts generous limits).
- The project rules the work followed: plain everyday names; the agent never resolves a thread; add only what is really needed (no unneeded guards, options or tests); every change shown failing first, then passing, and checked by a second, independent run.
