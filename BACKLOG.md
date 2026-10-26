# Backlog

Things that were found, decided against for now, or left open when v1 was wrapped up. Nothing here blocks using the tool. Each item says where to look and, where it matters, how it was found. Pick one, check it is still true, and delete it from this file when it is done.

Priority: **P1** can lose or confuse a user's data or work. **P2** is a visible rough edge. **P3** is cosmetic or an idea.

## Not verified at wrap-up

- **P1: the last full check was not finished.** The final gate was run in rounds. In the last round one reviewer passed (280 unit tests, 132 browser tests, a real Claude Code session) and the second, adversarial one was stopped before it returned. These were not repeated in that round: 100 refused agent resolves, queue attacks while sampling the item labels, performance and memory stress on a 40 000-element page, margin/padding/gap strips on odd elements, `init` and skill-copy edge cases, and the security checks. Each fix since the previous round was verified on its own. Run the full checks again before publishing a release.
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
- **P2: the send queue lives in the page.** It is lost on reload. No persistence by design.
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

## How the work was checked (for whoever continues)

- Unit: `npm test`. Browser: `npm run test:e2e` (builds first, real Chromium, no retries). Guard: `node scripts/guard.ts`. Type check: `npm run typecheck`.
- Performance: the stress scripts used for the investigation are not in the repo. The numbers worth keeping: on a 20 000-element page with 30 unmatched comments a scroll event should stay under 10 ms and idle CPU under about 100 ms per 10 s (`e2e/tests/large_page.spec.ts` asserts generous limits).
- The project rules the work followed: plain everyday names; the agent never resolves a thread; add only what is really needed (no unneeded guards, options or tests); every change shown failing first, then passing, and checked by a second, independent run.
