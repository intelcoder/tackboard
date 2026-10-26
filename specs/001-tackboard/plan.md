# Plan: Tackboard v1

Status: `implementing`
Branch: `feature/tackboard` · Base: `main` · Worktrees: one per track (A: `/Users/fiddlest/projects/tackboard-wt-a`, B: `/Users/fiddlest/projects/tackboard-wt-b`, C: `/Users/fiddlest/projects/tackboard-wt-c`, D: `/Users/fiddlest/projects/tackboard-wt-d`)
UI: `yes`

## Goal
A user clicks elements on their own dev site to leave comments, a coding agent claims and replies to them through a `tackboard` CLI, threads are kept per git branch with permanent history, and the whole project can be restored to an earlier message.

Sources (the authority; this plan converts them into the orchestrator template):
- Design: `docs/superpowers/specs/2026-10-25-llm-debugger-board-design.md` (sections 14 to 18 supersede earlier wording). Cited below as "spec §N".
- Existing plan: `docs/superpowers/plans/2026-10-25-tackboard.md` (cited as "source plan"). Its interfaces, file paths and test names are kept; every change to them is listed under "Deviations from the source plan" in Conventions.
- UI reference: https://claude.ai/artifact/Uqxcd6FxXnW59ZgLarPnp4 (read; CSS values quoted in T8, T9, T15).
- `spike/` is throwaway reference code (170 lines in 5 files, no tests); T11 deletes it.

## Out of scope
- `@` mention picker, `MentionMenu` and multiple agents: v1 has one default agent (spec §3).
- Drag-select and the fourth toolbar tool: v2 (spec §3, §18).
- Screenshots: spec §3.
- Browser extension and sites the user does not control: spec §3. The overlay is a script tag on a dev site the user controls.
- Live push (SSE or WebSocket): v1 polls every 1.5 s (spec §3).
- OS notifications while the tab is closed: unread items appear on next open (spec §5).
- Teams, cloud sync, sharing (spec §3).
- Per-thread undo: restore is a whole-project rewind (spec §16).
- Pushing restore notices into a running agent (hook or channel): agents learn on their next CLI call (spec §17).
- Component names beside tags in the ElementPath bar: spec §17 says it "can"; not built to keep v1 small.
- A bundler-cache isolation setup: N/A. The only bundler is esbuild's API, which keeps no persistent cache, and no component workshop or second dev server is added.

## Conventions
- **Naming (user rule, applies to all code from T6 on and to any code touched later):** every variable, function, class, type, file and CSS class uses short, plain, everyday English that says what the thing is or does (`pending_threads`, `claim_next`, `panel_is_open`, `.thread-row`). No jargon or buzzword names: avoid words like manager, helper, util, handler-factory, orchestrator, engine, processor, payload, context, wrapper, adapter-of-adapter, robust, seamless, enhanced, advanced, smart. Names the plan already fixes (the frozen contract in `packages/shared`, `Thread`, `Handler` classes required by the DDD layout) stay as they are. If a plan-fixed name is hard to read, keep it and say so in DEVIATIONS; do not silently rename a contract. Prefer a longer plain name over a short clever one. Comments are plain sentences too.
Sources: no CLAUDE.md exists in the repo yet; these rules come from the task statement, spec §6, §10, §13, §14 and the source plan "Global Constraints".

Language and runtime
- TypeScript everywhere (daemon, CLI, overlay, scripts, e2e). Node v22.22.2 runs `.ts` directly by type stripping, so: erasable syntax only (no `enum`, no constructor parameter properties, no `namespace`; `erasableSyntaxOnly` in `tsconfig.base.json`); type-only imports must use `import type` (`verbatimModuleSyntax`); relative imports carry explicit `.ts` extensions (`allowImportingTsExtensions`); no `tsconfig` `paths` (they do not exist at runtime); no `.js` or `.mjs` source files.
- Node does not strip types in files under `node_modules`. Workspace packages (`@app/shared`, `@app/daemon`, `@app/cli`, `@app/overlay`, `@app/vite-plugin`) are symlinks whose real path is `packages/*`, so they resolve outside `node_modules`. T1 proves this with a test (`workspace_import.test.ts`). Each package's `package.json` has `"exports": "./src/index.ts"`.
- `node:sqlite` prints an ExperimentalWarning to stderr. CLI and daemon tests assert on stdout and exit code only, never stderr.
- Exact versions: dependencies are pinned in `package.json` to the latest stable release that is at least two weeks old at install time (T1 records them).
- Allowed dependencies (user list, nothing else): `hono`, `@hono/node-server`, `esbuild`, `@playwright/test`, `linkedom` (dev, overlay unit tests), `react` and `react-dom` (dev, e2e fixture only, pinned to 18.x so fibers keep function-component names), `typescript` (dev, type checking only). See Open questions about `@types/node`.

Backend architecture (DDD, spec §6, user's global DDD default)
- Four layers under `packages/daemon/src/`: `domain/` (imports only itself and `import type` from `@app/shared`), `application/` (imports domain), `infrastructure/` (implements domain ports), `interface/` (Hono routes and process entry; imports application handlers only, holds no business rule).
- CQRS: one handler class per command or query, in `application/commands/` and `application/queries/`. Handlers call aggregate methods; state-transition rules live in `Thread`, never in handlers.
- Repositories are synchronous (`node:sqlite` is sync), so `claimNext` is atomic with no locks.
- Composition happens only in `interface/main.ts` and `interface/http.ts`.

Naming and branding (spec §13)
- Every user-facing name comes from `packages/shared/src/brand.ts`: product name, CLI binary, data folder, DB file name, config file name, git ref prefix, bundle file name, DOM host id, token header, config global, env prefix, source attribute. No other source file contains the product name in any form, including concatenated, templated or differently cased forms. Enforced by `scripts/guard.ts` (owner T1).
- Package and symbol names must not contain the product name (hence `sourceAttrPlugin`, workspace scope `@app`).

Security (spec §10, §14)
- Daemon binds `127.0.0.1` only. Every request must pass, in order: Host check (`127.0.0.1:<port>` or `localhost:<port>`, else 403 `forbidden_host`), Origin check (if an `Origin` header is present it must be in `allowedOrigins`, else 403 `forbidden_origin`), token check (header from `brand.tokenHeader`, else 401 `unauthorized`). Exceptions: `GET /health` and `GET <brand.bundle path>` skip the token; `OPTIONS` preflight skips the token but still needs an allowed Origin. CORS headers are sent only to allowed origins.
- The token is embedded in the served bundle. A page-readable token is unavoidable (spec §14); the allowed-origins list is the real protection, and T14 `security` tests that a foreign page can read the token yet cannot use it.
- Text is never rendered as HTML (see the text-only rule below).

Rules that span pages (each has one owner task and one test that checks every place it applies)
| Rule | Owner (implements it once) | Test that covers every use |
|---|---|---|
| Status label map (`pending`, `received`, `waiting on you`, `resolved`, `discarded`) | T1, `statusLabel()` in `packages/shared/src/status.ts` | T1 `statusLabel covers every ThreadStatus`; T9 `chip, ThreadItem, toast and badge text all come from statusLabel`; T11 `next and status output use statusLabel` |
| Text-only rendering (no HTML sinks anywhere in the overlay) | T1, `scripts/guard.ts` plus the `h()` builder in T8 | T1 guard tests (every sink form, probed indirectly); T9 `message text with img onerror becomes a text node`; T13 `xss` |
| Discarded filtering (excluded from claim, Open and Resolved lists, badge count, pins) | T3, `ListThreadsHandler` and `claimNext` | T3 `discarded threads are not claimable and sit in history`; T9 `badgeCount ignores discarded`; T14 `restore` |
| Restore-blocked reason (a thread is claimed and not stale) | T2, `Thread.restoreBlocker(threads, now)` | T2 `restoreBlocker names the claimed thread`; T3 list response carries it; T6 `restore_blocked`; T9 `RestoreConfirm is disabled with the reason`; T14 `restore` |
| Branch scoping (every list, claim, pin and badge is for one branch) | T3 handlers take a `Branch`; daemon reads the current branch from git, the CLI may pass its own | T3 `list filters by branch`; T7 `branch is read from git at post time`; T11 `an agent on branch B does not see threads from branch A`; T14 `branch_scoping` |
| Badge count definition (threads in `waiting` or unread, counted once, not discarded) | T9 `badgeCount()` | T9 `badgeCount counts waiting and unread threads once each`; T15 R07 and R08 |
| Hidden mode shows nothing (no pins, outline, crumbs, polling) | T8 mode controller, T9 poller subscribes to it | T8 `hidden mode renders no pins, outline or crumbs`; T12 `modes` |

Review Focus from the source plan (each maps to tests)
1. Reply or comment containing `<img onerror=...>` or `</script>` renders as text: T9 `message text with img onerror becomes a text node`, T13 `xss`.
2. Two `next` calls at the same instant never return the same thread: T3 `post then claim returns the thread and a second claim returns null`, T4 `claimNext is atomic`, T14 `claim_race`.
3. Restore with a dirty tree (modified, untracked, deleted) and restoring the safety snapshot back: T5 `restore returns modified, untracked and deleted files to the snapshot state`, T6 `restore rewinds files...`, T14 `restore`.
4. Branch names with slashes, detached HEAD, daemon outside a git repo: T5 `works on a branch name with a slash and on detached HEAD`, T7 `daemon started outside a git repo...` and `detached HEAD yields branch "HEAD"`, T11 `init in a non-git directory warns and next works on branch no-git`.
5. Oversized input (100 KB comment, 1 MB outerHTML): T7 `100 KB comment accepted, 150 KB rejected with 413...` and `1 MB html field is stored truncated to 4 KB`, T8 `html longer than 4 KB is truncated`, T13 `oversize`.

Facts the design rests on (re-check these quotes)
- `/Users/fiddlest/projects/llm-debugger-board/.gitignore` lines 1 to 5: `node_modules/`, `.tackboard/`, `.superpowers/`, `dist/`, `*.db`. So `dist/` (the overlay bundle) is not committed and must be built before e2e; the SQLite file and data folder are already ignored. T1 appends `e2e/artifacts/`, `test-results/`, `playwright-report/`.
- UI reference CSS: `.tb-panel{position:absolute;right:14px;bottom:78px;...;width:320px;...;max-height:400px}` and `.tb-modes{...padding:5px;gap:4px...}`. A fixed 320 px wide panel at `right:14px` overflows a 320 px viewport, so this plan deliberately sets `width:min(320px,calc(100vw - 28px))` and `max-height:min(400px,calc(100vh - 100px))` (292 px at a 320 px viewport). T15 measures it.
- UI reference CSS declares tokens on `:root`; in the overlay they go on `:host` inside the Shadow root, with dark values under `@media (prefers-color-scheme: dark)` and the pill staying dark in both themes ("dark icon pill on purpose"). The reference loads Google Fonts; the overlay does not (no network dependency on a host page): the `--display`, `--body`, `--mono` stacks fall back to system fonts.
- Spec §14: "Claims time out after 30 minutes", "Restore is blocked while a thread is claimed/working", "Pin matching: selector first, then tag + text, else detached", "Token is embedded in the script the daemon serves". Spec §18: Composer sits inside the panel; panel closed by default; pins hide while the element is off screen.
- The tree has no code except `spike/`. Spike files are not reused, only deleted.

Deviations from the source plan (every rename, re-signature, moved or added item, with the reason)
| # | Source plan | This plan | Reason |
|---|---|---|---|
| D1 | 13 tasks | 16 tasks (T1 to T16) | Template tracks A to D; contract and stub moved into T1; e2e split in four, style test added, as the planner rules require |
| D2 | `GET /threads` returns `ThreadDto[]` | returns `ListThreadsResponse` (branch, threads, history, agent, restoreBlocked) | The overlay needs the branch name (panel header), the agent presence (AgentBadge), the restore-blocked reason (RestoreConfirm, spec §18) and the archive/discard history (spec §5, §9) in one poll |
| D3 | `POST /threads/claim-next {agent}` returns a thread or null | `{agent, branch?}` returns `{thread}` | Source test "agent in a worktree on branch B does not see threads from branch A" needs the CLI branch; the daemon still uses its own git branch when none is sent |
| D4 | Routes listed in source Task 7 | Added `POST /threads/agent`, `POST /threads/:id/reopen`, `POST /threads/:id/read`, `GET /history`; `resolve` takes `{by, agent?}` | Spec §5 agent-started threads, §14 user can reopen and unread, §2 and §7 permanent history and "what the agent saw" |
| D5 | `Thread.resolve()` | `Thread.resolve(by)` | Resolution of the spec §14 tension: the agent cannot resolve while `waiting`, the user always can |
| D6 | `Thread.discardAfter(messageId)` | `Thread.discardAfterSeq(seq)` | "Later messages" in spec §5 and §9 means later across the whole branch, so messages carry a global `seq` |
| D7 | `tackboardVitePlugin` | `sourceAttrPlugin` | Brand rule: no source file contains the product name |
| D8 | `packages/overlay/build.mjs` | `packages/overlay/build.ts` plus `scripts/build.ts` | "TypeScript everywhere" |
| D9 | Domain events only named in spec | `Thread` records domain events; `events` table; `GET /history`; `claimed` event stores the full `ThreadDto` snapshot; CLI `history` | Spec §7: "The exact payload is stored in the log at claim time"; the source plan had no task or test for it |
| D10 | Restore only | Restore also appends a `system` message holding the safety checkpoint, and is rejected on the wrong branch | Gives the source e2e "second restore to the safety snapshot" a UI path; protects another branch's files (assumptions A1, A6) |
| D11 | CLI commands in source Task 8 | Added `history`, `init --port`; `start` runs the daemon entry in the foreground | Needed for D9 and for the e2e harness |
| D12 | Source Tasks 9 and 10 touch `index.ts` | `store.ts`, `dom.ts`, `styles_base.ts`, `styles_panel.ts`, `panel_logic.ts`, `thread_view.ts`, `poller.ts`, `toast.ts` added | Keeps pure logic testable under linkedom and keeps T8 and T9 from writing the same style file |
| D13 | Source Task 13 CI script | Folded into T16; scripts are created in T1 | Root `package.json` has one writer |

## Commands
One-time setup: `npm install` then `npx playwright install chromium`.

| Level | Command | Notes |
|---|---|---|
| Unit | `npm test` | Runs `node --test "packages/*/test/*.test.ts"`. Output ends with `ℹ tests N`, `ℹ pass N`, `ℹ fail 0`. Tests use flat `test()` calls only (no `describe`), so N counts tests. A contract suite run against two repositories counts twice |
| Integration | `npm test` | Real daemon, real CLI processes, temp git repos, in the same `node --test` run (files named `*.test.ts` in each package) |
| E2E (browser) | `npm run test:e2e` | Runs `npm run build` first, then `playwright test -c e2e/playwright.config.ts` (Chromium, `retries: 0`, `fullyParallel`, `workers: 4`). Output ends with `N passed`. One spec: `npx playwright test -c e2e/playwright.config.ts e2e/tests/<name>.spec.ts` |
| Lint/Build | `npm run build` | Runs `node scripts/build.ts`, which runs every `packages/*/build.ts` that exists (overlay bundle to `packages/overlay/dist/tackboard.js` via `brand.bundle`; CLI `bin` sync). Exit code 0 |
| Type check | `npm run typecheck` | `tsc --noEmit -p tsconfig.json`; expected: no output, exit code 0 |

## Contracts (frozen at T1)
Track B and track C start from T1 alone. Both build against the stub daemon (`Stub daemon`), and T7 runs the same `ApiContractSuite` against the real daemon, so the stub cannot drift silently. Any later change to a contract below needs a plan revision (Revision log row) that updates the stub, the suite and the real daemon together.

Shared DTOs (`packages/shared/src/types.ts`; written once in T1, quoted here in full)
- `ThreadStatus` is one of the strings `pending`, `received`, `waiting`, `resolved`.
- `ElementRef = { selector: string; tag: string; text: string; html: string; rect: { x: number; y: number; w: number; h: number }; component?: string[]; source?: string; confidence: Confidence }` where `Confidence` is `source`, `component` or `text`. `text` is at most 120 chars, `html` at most 4096 chars.
- `MessageDto = { id: string; author: string; text: string; at: number; discarded: boolean; checkpointId?: string; ask?: boolean }`. `author` is `user`, `system` or an agent name. Message ids are `m<n>` per thread. `user` and `system` are reserved names that `AgentName` rejects.
- `ThreadDto = { id: string; n: number; branch: string; commit: string; url: string; viewport: { w: number; h: number }; element: ElementRef; status: ThreadStatus; agent?: string; openedBy: "user" or "agent"; unread: boolean; discarded: boolean; claimedAt?: number; claimStale: boolean; messages: MessageDto[] }`. `discarded` is true when the first message is discarded. `n` is per branch.
- `ListThreadsResponse = { branch: string; threads: ThreadDto[]; history: ThreadDto[]; agent: { name: string or null; online: boolean }; restoreBlocked: string or null }`. `threads` = non-discarded threads of the branch. `history` = discarded threads of the branch plus every thread whose branch no longer exists in git (branches `HEAD` and `no-git` are never archived). `online` = an agent route was called in the last 60 s. `restoreBlocked` is the reason text or null.
- `RestoreResult = { restoredTo: string; discardedMessageIds: string[]; discardedThreadIds: string[]; changedFiles: string[]; safetyCheckpointId: string }`.
- `Notice = { id: string; at: number; restoredToMessage: string; files: string[]; discardedThreads: string[] }`.
- `HistoryEvent = { seq: number; threadId: string or null; type: string; at: number; data: unknown }` with `type` one of `posted`, `claimed`, `replied`, `resolved`, `reopened`, `released`, `requeued`, `restored`. `claimed.data = { thread: ThreadDto }` (the exact snapshot the agent was given).
- `ApiErrorBody = { error: ErrorCode; message: string }`. `ErrorCode` is one of `invalid` (400), `unauthorized` (401), `forbidden_host` (403), `forbidden_origin` (403), `not_found` (404), `not_pending` (409), `waiting_on_user` (409), `restore_blocked` (409), `wrong_branch` (409), `no_git` (409), `too_large` (413), `internal` (500).
- `ProjectConfig = { port: number; token: string; origins: string[]; userName: string }` stored at `<project>/<brand.dataDir>/<brand.configFile>`. `findConfig(startDir)` walks upward and returns `{ dir, config }` or null.

HTTP API v1 (`packages/shared/src/api.ts` holds the path builders and request/response types; JSON bodies; errors are `ApiErrorBody`)
| Route | Request | Response | Notes |
|---|---|---|---|
| `GET /health` | none | `{ ok: true }` | no token |
| `GET /<brand.bundle>` | none | JavaScript | no token; prepends `globalThis[brand.configGlobal] = { base, token }` to the built overlay |
| `GET /threads?branch=&state=` | none | `ListThreadsResponse` | `branch` defaults to the daemon's current git branch; `state` is `open` or `resolved` and only filters `threads` |
| `POST /threads` | `{ element: ElementRef, url, viewport, text }` | `ThreadDto` (201) | page-initiated; branch and commit are read from git by the daemon, never from the body |
| `POST /threads/agent` | `{ agent, selector, text, url? }` | `ThreadDto` (201) | agent-started thread; status `waiting`, unread; `element` built from the selector with `confidence` text |
| `POST /threads/claim-next` | `{ agent, branch? }` | `{ thread: ThreadDto or null }` | oldest pending non-discarded thread of the branch; stale claims on the branch are re-queued first |
| `POST /threads/:id/messages` | `{ author, text, ask? }` | `ThreadDto` | `author` `user` re-queues to pending; any other author is an agent reply; `ask` moves to `waiting` |
| `POST /threads/:id/resolve` | `{ by, agent? }` | `ThreadDto` | `by` is `user` or `agent` |
| `POST /threads/:id/reopen` | none | `ThreadDto` | resolved to pending |
| `POST /threads/:id/release` | none | `ThreadDto` | received to pending |
| `POST /threads/:id/read` | none | `ThreadDto` | clears `unread` |
| `POST /restore` | `{ threadId, messageId }` | `RestoreResult` | whole-project rewind |
| `GET /notices?agent=` | none | `{ notices: Notice[] }` | pending notices for the agent; also registers the agent |
| `POST /agents/:name/ack` | none | `{ ok: true }` | |
| `GET /history?threadId=` | none | `{ events: HistoryEvent[] }` | all events when `threadId` is omitted |

Limits: request body 2 MB, comment or reply text 100 KB (102400 characters, else 413 `too_large`), `html` truncated to 4096 characters, selector at most 1000 characters (else 400 `invalid`).

Daemon entry (`Daemon entry`): `node packages/daemon/src/interface/main.ts <projectDir>` reads `<projectDir>/<brand.dataDir>/<brand.configFile>`, opens `<brand.dataDir>/<brand.dbFile>`, binds `127.0.0.1:<config.port>`, prints `listening 127.0.0.1:<port>` on stdout when ready, exits on SIGTERM. When `NODE_ENV=test`, the env var `<brand.envPrefix>CLOCK_OFFSET_MIN` shifts the clock (used for stale claims). `createDaemon(opts: { projectDir: string; port: number; allowedOrigins: string[]; token: string; clock?: Clock; bundlePath?: string }): { listen(): Promise<number>; address(): { address: string; port: number } or null; close(): Promise<void> }`.

Overlay boot contract (`Overlay config global`): the page loads `<script src="http://127.0.0.1:<port>/<brand.bundle>">`; the overlay reads `globalThis[brand.configGlobal]` for `{ base, token }`, creates one host element with id `brand.hostId` and an open Shadow root, and sends the token in the `brand.tokenHeader` header on every call.

CLI exit codes: 0 success including "no pending threads"; 1 for any error, printing the daemon's `message` on stdout.

## Dependencies & conflicts
| Task | Track | Depends on | Writes (files) | Contracts | Conflicts with |
|---|---|---|---|---|---|
| T1 | A | — | `package.json`, `tsconfig.base.json`, `tsconfig.json`, `.gitignore`, `scripts/build.ts`, `scripts/guard.ts`, `packages/shared/package.json`, `packages/shared/src/index.ts`, `packages/shared/src/brand.ts`, `packages/shared/src/types.ts`, `packages/shared/src/status.ts`, `packages/shared/src/api.ts`, `packages/shared/src/config.ts`, `packages/shared/test-support/stub_daemon.ts`, `packages/shared/test-support/api_contract.ts`, `packages/shared/test/brand.test.ts`, `packages/shared/test/status.test.ts`, `packages/shared/test/config.test.ts`, `packages/shared/test/guard.test.ts`, `packages/shared/test/stub_contract.test.ts`, `packages/daemon/package.json`, `packages/daemon/test/workspace_import.test.ts`, `packages/cli/package.json`, `packages/overlay/package.json`, `packages/vite-plugin/package.json` | provides `Brand`; provides `Shared DTOs`; provides `HTTP API v1`; provides `ProjectConfig`; provides `Daemon entry`; provides `Stub daemon`; provides `ApiContractSuite`; provides `Guard script`; provides `Build runner` | — |
| T2 | A | T1 | `packages/daemon/src/domain/value_objects.ts`, `packages/daemon/src/domain/errors.ts`, `packages/daemon/src/domain/thread.ts`, `packages/daemon/test/thread.test.ts` | provides `Thread aggregate`; consumes `Shared DTOs` | — |
| T3 | A | T2 | `packages/daemon/src/domain/repositories.ts`, `packages/daemon/src/application/commands/post_comment.ts`, `packages/daemon/src/application/commands/post_agent_comment.ts`, `packages/daemon/src/application/commands/claim_next_thread.ts`, `packages/daemon/src/application/commands/reply_to_thread.ts`, `packages/daemon/src/application/commands/resolve_thread.ts`, `packages/daemon/src/application/commands/reopen_thread.ts`, `packages/daemon/src/application/commands/release_thread.ts`, `packages/daemon/src/application/commands/mark_read.ts`, `packages/daemon/src/application/queries/get_thread.ts`, `packages/daemon/src/application/queries/list_threads.ts`, `packages/daemon/src/application/queries/get_history.ts`, `packages/daemon/test/in_memory_repo.ts`, `packages/daemon/test/handlers.test.ts` | provides `Repository ports`; provides `Handlers`; consumes `Thread aggregate` | T6 |
| T4 | A | T3 | `packages/daemon/src/domain/thread.ts`, `packages/daemon/src/infrastructure/sqlite_thread_repository.ts`, `packages/daemon/src/infrastructure/clock.ts`, `packages/daemon/test/thread_repository.contract.ts`, `packages/daemon/test/sqlite_thread_repository.test.ts` | provides `SqliteThreadRepository`; consumes `Repository ports` | T6 |
| T5 | A | T3 | `packages/daemon/src/domain/checkpoint_store.ts`, `packages/daemon/src/infrastructure/git_checkpoint_store.ts`, `packages/daemon/src/infrastructure/git_info.ts`, `packages/daemon/test/git_checkpoint_store.test.ts`, `packages/daemon/test/git_info.test.ts` | provides `CheckpointStore`; provides `GitInfo adapter`; consumes `Repository ports` | — |
| T6 | A | T4, T5 | `packages/daemon/src/domain/notice.ts`, `packages/daemon/src/application/commands/restore_to_message.ts`, `packages/daemon/src/application/commands/ack_notices.ts`, `packages/daemon/src/application/queries/get_notices.ts`, `packages/daemon/src/application/commands/claim_next_thread.ts`, `packages/daemon/src/application/commands/reply_to_thread.ts`, `packages/daemon/src/application/commands/resolve_thread.ts`, `packages/daemon/src/domain/repositories.ts`, `packages/daemon/src/infrastructure/sqlite_thread_repository.ts`, `packages/daemon/test/in_memory_repo.ts`, `packages/daemon/test/thread_repository.contract.ts`, `packages/daemon/test/restore.test.ts` | provides `Restore and notices`; consumes `CheckpointStore`; consumes `SqliteThreadRepository`; consumes `Handlers` | T3, T4 |
| T7 | A | T6 | `packages/daemon/src/interface/security.ts`, `packages/daemon/src/interface/http.ts`, `packages/daemon/src/interface/main.ts`, `packages/daemon/src/index.ts`, `packages/daemon/test/http.test.ts`, `packages/daemon/test/security.test.ts`, `packages/daemon/test/api_contract.test.ts` | provides `Real daemon`; consumes `HTTP API v1`; consumes `ApiContractSuite`; consumes `Restore and notices` | — |
| T8 | B | T1 | `packages/overlay/src/index.ts`, `packages/overlay/src/api.ts`, `packages/overlay/src/dom.ts`, `packages/overlay/src/store.ts`, `packages/overlay/src/element_ref.ts`, `packages/overlay/src/modes.ts`, `packages/overlay/src/hover.ts`, `packages/overlay/src/pins.ts`, `packages/overlay/src/styles_base.ts`, `packages/overlay/build.ts`, `packages/overlay/test/element_ref.test.ts`, `packages/overlay/test/api.test.ts`, `packages/overlay/test/hover_pins.test.ts`, `packages/overlay/test/build.test.ts` | provides `Overlay core`; provides `Overlay bundle`; consumes `HTTP API v1`; consumes `Stub daemon`; consumes `Shared DTOs` | — |
| T9 | B | T8 | `packages/overlay/src/panel.ts`, `packages/overlay/src/panel_logic.ts`, `packages/overlay/src/thread_view.ts`, `packages/overlay/src/notifications.ts`, `packages/overlay/src/toast.ts`, `packages/overlay/src/poller.ts`, `packages/overlay/src/styles_panel.ts`, `packages/overlay/src/index.ts`, `packages/overlay/test/panel_logic.test.ts`, `packages/overlay/test/thread_view.test.ts` | provides `Overlay panel`; consumes `Overlay core`; consumes `Stub daemon` | — |
| T10 | B | T8 | `packages/overlay/src/source_map.ts`, `packages/overlay/src/element_ref.ts`, `packages/vite-plugin/src/index.ts`, `packages/overlay/test/source_map.test.ts`, `packages/vite-plugin/test/plugin.test.ts` | provides `Source mapping`; provides `Source attribute plugin`; consumes `Overlay core` | — |
| T11 | C | T1 | `packages/cli/src/main.ts`, `packages/cli/src/client.ts`, `packages/cli/src/format.ts`, `packages/cli/src/commands.ts`, `packages/cli/src/index.ts`, `packages/cli/build.ts`, `packages/cli/test/cli.test.ts`, `packages/cli/test/format.test.ts`, `spike/` | provides `CLI`; consumes `HTTP API v1`; consumes `Stub daemon`; consumes `Daemon entry`; consumes `ProjectConfig` | — |
| T12 | D | T7, T9, T11 | `e2e/playwright.config.ts`, `e2e/fixtures/harness.ts`, `e2e/fixtures/site/index.html`, `e2e/fixtures/states.ts`, `e2e/tests/comment_loop.spec.ts`, `e2e/tests/modes.spec.ts`, `e2e/tests/nested_hover.spec.ts` | provides `E2E harness`; consumes `Real daemon`; consumes `CLI`; consumes `Overlay panel` | — |
| T13 | D | T12 | `e2e/tests/panel_ui.spec.ts`, `e2e/tests/scroll_links.spec.ts`, `e2e/tests/notifications.spec.ts`, `e2e/tests/xss.spec.ts`, `e2e/tests/detached.spec.ts`, `e2e/tests/oversize.spec.ts` | consumes `E2E harness`; consumes `Overlay panel` | — |
| T14 | D | T12, T10 | `e2e/fixtures/harness.ts`, `e2e/fixtures/react-site/src/main.tsx`, `e2e/fixtures/react-site/src/PricingPage.tsx`, `e2e/fixtures/react-site/src/PlanCard.tsx`, `e2e/fixtures/react-site/build.ts`, `e2e/tests/branch_scoping.spec.ts`, `e2e/tests/restore.spec.ts`, `e2e/tests/persistence.spec.ts`, `e2e/tests/claim_race.spec.ts`, `e2e/tests/stale_claim.spec.ts`, `e2e/tests/security.spec.ts`, `e2e/tests/react_mapping.spec.ts` | consumes `E2E harness`; consumes `Source mapping`; consumes `Source attribute plugin`; consumes `Restore and notices` | — |
| T15 | D | T12, T13 | `e2e/fixtures/states.ts`, `e2e/tests/style_rows.ts`, `e2e/tests/styles.spec.ts`, `e2e/tests/responsive.spec.ts`, `packages/overlay/src/panel.ts`, `packages/overlay/src/panel_logic.ts`, `packages/overlay/test/panel_logic.test.ts` | provides `Style rows`; consumes `E2E harness`; consumes `Overlay panel` | — |
| T16 | D | T13, T14, T15 | `README.md` | consumes `E2E harness` | — |
| T17 | A | T16 | `packages/daemon/src/application/commands/post_comment.ts`, `packages/daemon/src/domain/repositories.ts`, `packages/daemon/src/domain/thread.ts`, `packages/daemon/src/infrastructure/sqlite_thread_repository.ts`, `packages/daemon/test/in_memory_repo.ts`, `packages/daemon/test/thread_repository.contract.ts`, `packages/daemon/test/daemon_setup.ts`, `packages/daemon/test/restore.test.ts`, `packages/daemon/test/git_checkpoint_store.test.ts`, `packages/daemon/test/git_info.test.ts`, `packages/cli/test/cli.test.ts`, `packages/cli/test/format.test.ts`, `packages/shared/test-support/stub_daemon.ts`, `e2e/tests/security.spec.ts` | none | — |
| T18 | B | T16 | `packages/overlay/src/toast.ts`, `packages/overlay/src/index.ts`, `packages/overlay/src/dom.ts`, `packages/overlay/src/store.ts`, `packages/overlay/src/modes.ts`, `packages/overlay/src/panel.ts` | none | — |
| T19 | A | T17, T18 | `packages/daemon/src/interface/security.ts`, `packages/daemon/src/interface/http.ts`, `packages/daemon/test/security.test.ts`, `packages/daemon/test/http.test.ts`, `package-lock.json` | none | — |
| T20 | B | T19 | `packages/overlay/src/thread_view.ts`, `packages/overlay/src/panel.ts`, `packages/overlay/src/panel_logic.ts`, `packages/overlay/src/notifications.ts`, `packages/overlay/src/styles_panel.ts`, `packages/overlay/test/thread_view.test.ts`, `packages/overlay/test/panel_logic.test.ts`, `packages/daemon/src/domain/thread.ts`, `packages/daemon/test/restore.test.ts`, `e2e/tests/design_fixes.spec.ts`, `e2e/tests/style_rows.ts`, `e2e/tests/styles.spec.ts` | none | — |
| T21 | C | T20 | `skills/tackboard/SKILL.md`, `packages/cli/src/commands.ts`, `packages/cli/test/cli.test.ts`, `packages/cli/test/skill.test.ts`, `README.md` | none | — |
| T22 | C | T21 | `README.md` | none | — |
| T23 | B | T22 | `packages/overlay/src/panel.ts`, `packages/overlay/src/thread_view.ts`, `packages/overlay/test/thread_view.test.ts`, `e2e/tests/reply_box.spec.ts` | none | — |
| T24 | C | T22 | `skills/tackboard/SKILL.md`, `packages/cli/src/commands.ts`, `packages/cli/test/cli.test.ts`, `packages/cli/test/skill.test.ts`, `README.md` | none | — |
| T25 | B | T23 | `e2e/tests/reply_box.spec.ts` | none | — |
| T26 | C | T24 | `README.md`, `skills/tackboard/SKILL.md`, `packages/cli/test/skill.test.ts` | none | — |
| T27 | B | T25 | `packages/overlay/src/panel.ts`, `e2e/tests/reply_box.spec.ts` | none | — |
| T28 | C | T26 | `packages/cli/src/commands.ts`, `packages/cli/test/cli.test.ts`, `skills/tackboard/SKILL.md`, `packages/cli/test/skill.test.ts`, `README.md` | none | — |
| T29 | A | T27, T28 | `packages/daemon/src/domain/thread.ts`, `packages/daemon/src/application/commands/resolve_thread.ts`, `packages/daemon/src/interface/http.ts`, `packages/daemon/test/thread.test.ts`, `packages/daemon/test/handlers.test.ts`, `packages/daemon/test/http.test.ts`, `packages/daemon/test/restore.test.ts`, `packages/daemon/test/sqlite_thread_repository.test.ts`, `packages/daemon/test/thread_repository.contract.ts`, `packages/shared/test-support/api_contract.ts`, `packages/shared/test-support/stub_daemon.ts`, `packages/cli/src/commands.ts`, `packages/cli/src/format.ts`, `packages/cli/test/cli.test.ts`, `packages/cli/test/format.test.ts`, `packages/cli/test/skill.test.ts`, `e2e/fixtures/states.ts`, `e2e/tests/comment_loop.spec.ts`, `e2e/tests/design_fixes.spec.ts`, `e2e/tests/persistence.spec.ts`, `e2e/tests/responsive.spec.ts`, `e2e/tests/restore.spec.ts`, `e2e/tests/style_rows.ts`, `README.md`, `skills/tackboard/SKILL.md` | changes `HTTP API v1` resolve: an agent request is refused | — |
| T30 | B | T25, T29 | `packages/overlay/src/outbox.ts`, `packages/overlay/src/api.ts`, `packages/overlay/src/panel.ts`, `packages/overlay/src/thread_view.ts`, `packages/overlay/src/panel_logic.ts`, `packages/overlay/src/styles_panel.ts`, `packages/overlay/test/outbox.test.ts`, `packages/overlay/test/thread_view.test.ts`, `packages/overlay/test/panel_logic.test.ts`, `e2e/tests/send_queue.spec.ts`, `e2e/tests/reply_box.spec.ts`, `e2e/tests/oversize.spec.ts`, `e2e/tests/security.spec.ts`, `README.md` | none | — |
| T32 | B | T30 | `packages/overlay/src/element_ref.ts`, `packages/overlay/src/pins.ts`, `packages/overlay/src/panel.ts`, `packages/overlay/src/panel_logic.ts`, `packages/overlay/test/element_ref.test.ts`, `packages/overlay/test/hover_pins.test.ts`, `packages/overlay/test/panel_logic.test.ts`, `packages/overlay/src/thread_view.ts`, `packages/overlay/test/thread_view.test.ts`, `e2e/tests/large_page.spec.ts` | none | — |
| T33 | C | T29 | `packages/cli/src/channel.ts`, `packages/cli/src/commands.ts`, `packages/cli/test/channel.test.ts`, `packages/cli/test/cli.test.ts`, `skills/tackboard/SKILL.md`, `README.md` | none | — |
| T35 | B | T32, T33 | `packages/overlay/src/box_model.ts`, `packages/overlay/src/hover.ts`, `packages/overlay/src/styles_base.ts`, `packages/overlay/test/box_model.test.ts`, `e2e/tests/box_model.spec.ts`, `README.md` | none | — |
| T36 | B | T35 | `packages/overlay/src/hover.ts`, `packages/overlay/src/element_ref.ts`, `packages/overlay/src/pins.ts`, `packages/overlay/src/panel.ts`, `packages/overlay/src/styles_panel.ts`, `packages/overlay/test/element_ref.test.ts`, `packages/overlay/test/hover_pins.test.ts`, `e2e/tests/comment_loop.spec.ts`, `e2e/tests/send_queue.spec.ts`, `e2e/tests/reply_box.spec.ts` | none | — |
| T37 | C | T35 | `packages/daemon/test/http.test.ts`, `packages/daemon/test/handlers.test.ts`, `packages/cli/src/channel.ts`, `packages/cli/test/skill.test.ts`, `packages/cli/test/cli.test.ts`, `README.md` | none | — |
| T38 | B | T37 | `packages/overlay/src/outbox.ts`, `packages/overlay/src/panel.ts`, `packages/overlay/src/thread_view.ts`, `packages/overlay/test/outbox.test.ts`, `packages/overlay/test/thread_view.test.ts`, `e2e/tests/send_queue.spec.ts` | none | — |
| T39 | A | T37 | `packages/daemon/src/application/commands/resolve_thread.ts`, `packages/daemon/src/domain/thread.ts`, `packages/daemon/test/thread.test.ts`, `packages/daemon/test/handlers.test.ts`, `packages/daemon/test/http.test.ts`, `packages/shared/test-support/api_contract.ts` | none | — |
| T40 | C | T37 | `packages/cli/src/channel.ts`, `packages/cli/test/channel.test.ts`, `README.md` | none | — |
| T41 | B | T40 | `packages/overlay/src/panel.ts`, `packages/overlay/src/panel_logic.ts`, `packages/overlay/src/styles_panel.ts`, `packages/overlay/test/panel_logic.test.ts`, `packages/overlay/src/modes.ts`, `e2e/tests/batch.spec.ts`, `e2e/tests/send_queue.spec.ts`, `e2e/tests/comment_loop.spec.ts`, `e2e/tests/panel_ui.spec.ts`, `e2e/tests/oversize.spec.ts`, `e2e/tests/security.spec.ts`, `README.md` | none | — |
| T42 | B | T41 | `packages/overlay/src/panel.ts`, `packages/overlay/src/styles_panel.ts`, `e2e/tests/batch.spec.ts`, `e2e/tests/modes.spec.ts`, `e2e/tests/nested_hover.spec.ts`, `e2e/tests/responsive.spec.ts` | none | — |
| T43 | B | T42 | `packages/overlay/src/*.ts`, `packages/overlay/test/*.ts`, `packages/cli/src/channel.ts`, `packages/cli/src/commands.ts`, `packages/cli/test/channel.test.ts`, `e2e/tests/*.spec.ts`, `e2e/fixtures/harness.ts`, `scripts/guard.ts`, `README.md`, `BACKLOG.md`, `skills/tackboard/SKILL.md` | renames files and names inside the overlay, the channel, the CLI and two helpers; no contract change | — |

Conflict resolutions: T4 and T6 both write `sqlite_thread_repository.ts` and `thread_repository.contract.ts`, and T3 and T6 both write handler files and `repositories.ts` and `in_memory_repo.ts`: all are in track A and ordered (T3, T4, T6). T8 creates `packages/overlay/src/index.ts` and `element_ref.ts`; T9 later edits only `index.ts` and T10 later edits only `element_ref.ts`: all three are in track B and run one after another (T8, then T9 and T10, which share no file). T12, T14 and T15 all edit files under `e2e/fixtures/` (`harness.ts` by T12 then T14, `states.ts` by T12 then T15): same track D, ordered. T1 is the only writer of the root `package.json`, `tsconfig*.json` and `.gitignore`. CLI formatting of `component`, `source` and `confidence` is built in T11 from the start (the fields already exist on `ElementRef`), so T10 never touches the CLI. Every spec file is written by exactly one D task.

## Tasks

### T1: Scaffold, brand, shared types, API contract, stub daemon, guard
- **Track / depends on:** A / none
- **Why:** Everything depends on one set of names, types and the HTTP contract. Freezing the contract and a small stub here lets tracks B (overlay) and C (CLI) start without waiting for the real daemon, and the shared contract suite keeps the stub honest.
- **Files:**
  - `package.json` (new: `private`, `workspaces: ["packages/*"]`, `type: "module"`, scripts `test`, `test:e2e`, `build`, `typecheck`), `tsconfig.base.json` (new), `tsconfig.json` (new, includes `packages/*/src`, `packages/*/test`, `packages/*/test-support`, `scripts`, `e2e`), `.gitignore` (edit: append `e2e/artifacts/`, `test-results/`, `playwright-report/`)
  - `scripts/build.ts` (new), `scripts/guard.ts` (new)
  - `packages/shared/package.json`, `packages/shared/src/{index.ts,brand.ts,types.ts,status.ts,api.ts,config.ts}` (all new)
  - `packages/shared/test-support/stub_daemon.ts` (new), `packages/shared/test-support/api_contract.ts` (new)
  - `packages/shared/test/{brand,status,config,guard,stub_contract}.test.ts` (new)
  - `packages/daemon/package.json`, `packages/daemon/test/workspace_import.test.ts`, `packages/cli/package.json`, `packages/overlay/package.json`, `packages/vite-plugin/package.json` (new; names `@app/<dir>`, `exports` `./src/index.ts`)
- **Steps:**
  1. `npm install` the allowed dependencies only (plus the answer to the `@types/node` question). Record exact versions.
  2. `tsconfig.base.json`: `target ES2023`, `module nodenext`, `strict`, `noEmit`, `allowImportingTsExtensions`, `erasableSyntaxOnly`, `verbatimModuleSyntax`, `lib ["ES2023","DOM"]`, `types ["node"]`.
  3. `brand.ts` exports `brand = { name: "Tackboard", cli: "tackboard", dataDir: ".tackboard", dbFile: "tackboard.db", configFile: "config.json", refPrefix: "refs/tackboard/", bundle: "tackboard.js", hostId: "tackboard-root", tokenHeader: "x-tackboard-token", configGlobal: "__TACKBOARD__", envPrefix: "TACKBOARD_", sourceAttr: "data-tb-src" } as const`. This file is the only place the name appears.
  4. `types.ts` and `api.ts` exactly as in the Contracts section (types, path builders such as `paths.thread(id)`, `ErrorCode` list, `LIMITS = { body: 2*1024*1024, text: 102400, html: 4096, elementText: 120, selector: 1000 }`).
  5. `status.ts`: `statusLabel(s: ThreadStatus | "discarded"): string` returning `pending`, `received`, `waiting on you`, `resolved`, `discarded`.
  6. `config.ts`: `readConfig(dir)`, `writeConfig(dir, config)`, `findConfig(startDir)` (walks up to the filesystem root).
  7. `scripts/guard.ts`: exports `findViolations(files: {path: string; text: string}[]): Violation[]` and a `main` that scans the real tree. Rule 1 (brand): after lowercasing and stripping `"'` + backtick, `+` and whitespace characters, the text must not contain the product name; applies to `packages/*/src`, `scripts`, `e2e/fixtures`, `e2e/playwright.config.ts`; `packages/shared/src/brand.ts` is exempt. Rule 2 (HTML sinks): `packages/overlay/src` must not contain `innerHTML`, `outerHTML` (assignment), `insertAdjacentHTML`, `document.write`, `createContextualFragment`, `DOMParser`, `setHTMLUnsafe`, `srcdoc`. Test directories are exempt.
  8. `scripts/build.ts`: runs each existing `packages/*/build.ts` with `node`, in directory order, exiting non-zero on the first failure.
  9. `stub_daemon.ts`: `startStubDaemon(opts?: { token?: string }): Promise<{ url: string; token: string; close(): Promise<void>; seedNotice(n: Notice): void; setBranch(b: string): void }>`. In-memory, Node `http`, implements every route in the HTTP API v1 table with the minimal state machine (pending, received, waiting, resolved), the 401, 404, 409 and 413 errors, and `ListThreadsResponse`. No git, no checkpoints (restore returns a canned `RestoreResult`), no Host or Origin checks.
  10. `api_contract.ts`: `runApiContract(label: string, start: () => Promise<{url: string; token: string; close(): Promise<void>}>)` registers the eight `node:test` tests listed below.
  11. Tests, then the `workspace_import` test, then `npm test`, `npm run typecheck`.
- **Tests:**
  - Unit `packages/shared/test/brand.test.ts`: `brand fields have the expected values` asserts `cli === "tackboard"`, `dataDir === ".tackboard"`, `refPrefix === "refs/tackboard/"`, `bundle === "tackboard.js"`, `envPrefix === "TACKBOARD_"`.
  - Unit `status.test.ts`: `statusLabel covers every ThreadStatus` asserts the four labels plus `discarded` and that no label is empty.
  - Unit `config.test.ts`: `findConfig walks up from a nested directory` (temp dir, config at root, search from `a/b/c`, asserts `dir` and `config.port`); `findConfig returns null outside a project`; `writeConfig then readConfig round-trips`.
  - Unit `guard.test.ts`: `guard flags each banned DOM sink form` (one sample string per form: `el.innerHTML = x`, `el.outerHTML = x`, `el.insertAdjacentHTML(`, `document.write(`, `range.createContextualFragment(`, `new DOMParser()`, `el.setHTMLUnsafe(`, `iframe.srcdoc = x`; each is reported with its form name); `guard flags the brand name in indirect forms` (the plain name, uppercase `TACKBOARD`, a path such as `.tackboard/`, a header such as `x-tackboard-token`, and string concatenation `"tack" + "board"`; each reported. A split across a template-literal expression is a documented limit of the guard and is not probed); `guard exempts brand.ts and test directories`; `real tree has no violations` (runs `findViolations` over the repository and asserts an empty list; it stays green as later tasks add files).
  - Integration `daemon/test/workspace_import.test.ts`: `daemon package can import shared by package name` imports `brand` and a type from `@app/shared` and asserts `brand.cli === "tackboard"` (proves type stripping and the symlink resolution).
  - Integration `shared/test/stub_contract.test.ts` calls `runApiContract("stub", startStubDaemon)`, registering: `contract: post then list round-trip` (POST then GET returns the thread with every `ThreadDto` key); `contract: claim-next returns oldest first then null`; `contract: agent ask moves to waiting and user reply re-queues to pending`; `contract: resolve while waiting by agent is 409 waiting_on_user`; `contract: user may resolve a waiting thread`; `contract: missing token is 401 except health`; `contract: 150 KB text is 413 too_large and health still answers`; `contract: unknown thread is 404 not_found`.
  - E2E: N/A — no UI in this task.
- **Run:** `npm test`, expected `ℹ tests 18`, `ℹ pass 18`, `ℹ fail 0` (1 brand + 1 status + 3 config + 4 guard + 1 workspace + 8 contract); `npm run typecheck` exits 0.
- **Acceptance:**
  - The Contracts section's types and routes exist verbatim in `types.ts` and `api.ts`.
  - The stub passes the eight contract tests.
  - The guard probes catch every listed indirect form and the real tree is clean.
  - `npm run build` exits 0 even though no package has a `build.ts` yet.

### T2: Domain: value objects and the Thread aggregate
- **Track / depends on:** A / T1
- **Why:** All state rules (claim, ask, resolve, stale, discard, restore blocking, history events) live in one aggregate so no handler or client re-implements them.
- **Files:** `packages/daemon/src/domain/value_objects.ts` (new), `packages/daemon/src/domain/errors.ts` (new), `packages/daemon/src/domain/thread.ts` (new), `packages/daemon/test/thread.test.ts` (new)
- **Steps:**
  1. `errors.ts`: `class DomainError extends Error { code: ErrorCode }` (plain field assignment in the constructor body; no parameter properties).
  2. `value_objects.ts`: `Branch.of(name)` (non-empty, accepts `feature/pricing`, `HEAD`, `no-git`), `CommitSha.of(s)`, `AgentName.of(s)` (non-empty, `[a-z0-9._-]`, max 40, rejects the reserved `user` and `system`).
  3. `thread.ts`: `class Thread` with `static open(a: { id; n; branch: Branch; commit: CommitSha; url; viewport; element: ElementRef; text; now; seq: number }): Thread`, `static openByAgent(a: { id; n; branch; commit; url; element; agent: AgentName; text; now; seq }): Thread` (status `waiting`, unread true), `claim(agent, now)`, `reply(author: string, text, now, seq, opts?: { ask?: boolean })`, `resolve(by: "user" or "agent")`, `release()`, `reopen()`, `markRead()`, `isStaleClaim(now)` (stale when `now - claimedAt > 30*60_000`), `discardAfterSeq(seq): string[]` (returns ids of messages newly discarded), `attachCheckpoint(messageId, checkpointId)`, `addSystemMessage(text, now, seq, checkpointId)`, `pullEvents(): DomainEvent[]`, static `restoreBlocker(threads: Thread[], now: number): string or null` (names the first claimed, non-stale thread), `toDto(now): ThreadDto`. Getters `status`, `messages`, `agent`, `discarded`.
  4. Rules: `claim` only from `pending` (else `not_pending`); agent reply with `ask` goes to `waiting`, an agent reply without `ask` keeps `received`; a user reply on any non-resolved thread goes to `pending`, clears `agent`, and a user reply on a `resolved` thread is allowed and reopens to `pending`; agent `resolve` while `waiting` throws `waiting_on_user`; user `resolve` is always allowed on a non-resolved thread; `reopen` only from `resolved`; agent replies set `unread`; user messages do not. Events recorded: `posted`, `claimed` (data `{ thread: toDto(now) }`), `replied`, `resolved`, `reopened`, `released`, `requeued` (when a stale claim is released), `restored` is added in T6.
  5. Message ids are `m<n>` per thread; every message has a global `seq` argument supplied by the caller.
- **Tests:** (all in `thread.test.ts`)
  - Unit: `open creates pending thread with one user message`
  - `openByAgent creates a waiting unread thread owned by the agent`
  - `claim moves pending to received and records agent`
  - `claim on a non-pending thread throws DomainError "not_pending"`
  - `agent reply with ask moves to waiting`
  - `agent reply without ask keeps received`
  - `user reply moves any non-resolved thread to pending and clears agent`
  - `resolve while waiting by agent throws "waiting_on_user"`
  - `user may resolve a waiting thread`
  - `resolve after reply succeeds`
  - `reopen on resolved returns pending`
  - `stale claim: isStaleClaim(claimedAt + 30*60_000 + 1) is true, at exactly +30*60_000 is false`
  - `discardAfterSeq marks later messages discarded and leaves earlier ones`
  - `a thread whose first message is discarded reports discarded true`
  - `restoreBlocker names the claimed thread` (null when no thread is claimed, null when the only claim is stale, a reason string containing the thread number otherwise)
  - `claim records a claimed event holding the full ThreadDto snapshot`
  - `Branch.of accepts "feature/pricing" and "HEAD"; AgentName.of rejects "", "user" and "system"`
  - Integration / E2E: N/A — pure domain; the flows are owned by T3 (handlers) and T12.
- **Run:** `node --test packages/daemon/test/thread.test.ts`, expected `ℹ tests 17`, `ℹ pass 17`, `ℹ fail 0`.
- **Acceptance:** `domain/` imports nothing outside itself except `import type` from `@app/shared`; no handler logic is needed to enforce any rule above; `npm run typecheck` exits 0.

### T3: Application layer on an in-memory repository
- **Track / depends on:** A / T2
- **Why:** Gives every command and query a single-purpose handler over repository ports, testable before SQLite and git exist.
- **Files:** `packages/daemon/src/domain/repositories.ts` (new), `packages/daemon/src/application/commands/{post_comment,post_agent_comment,claim_next_thread,reply_to_thread,resolve_thread,reopen_thread,release_thread,mark_read}.ts` (new), `packages/daemon/src/application/queries/{get_thread,list_threads,get_history}.ts` (new), `packages/daemon/test/in_memory_repo.ts` (new, test helper), `packages/daemon/test/handlers.test.ts` (new)
- **Steps:**
  1. `repositories.ts`: `interface ThreadRepository { nextId(): string; nextNumber(branch: Branch): number; nextSeq(): number; get(id: string): Thread or null; save(t: Thread): void; claimNext(branch: Branch, agent: AgentName, now: number): Thread or null; listByBranch(branch: Branch): Thread[]; listAll(): Thread[]; history(threadId?: string): HistoryEvent[]; touchAgent(name: string, now: number): void; lastAgent(now: number): { name: string or null; online: boolean }; }`, `interface Clock { now(): number }`, `interface GitInfo { branch(): Branch; commit(): CommitSha; branches(): string[] }`. `save` persists the thread, its messages and appends `pullEvents()` to the event log in one operation. `claimNext` re-queues stale claims on the branch (recording `requeued`), then applies `Thread.claim` and persists in one synchronous call; it never returns a discarded thread.
  2. Handlers are classes with `handle(cmd)`: `PostCommentHandler.handle({ element, url, viewport, text }): ThreadDto` (truncates `element.html` to 4096 and `element.text` to 120, branch and commit from `GitInfo`); `PostAgentCommentHandler.handle({ agent, selector, text, url? })`; `ClaimNextThreadHandler.handle({ agent, branch? }): ThreadDto or null`; `ReplyToThreadHandler.handle({ id, author, text, ask? }): ThreadDto`; `ResolveThreadHandler.handle({ id, by, agent? })`; `ReopenThreadHandler`; `ReleaseThreadHandler`; `MarkReadHandler`; `GetThreadHandler`; `ListThreadsHandler.handle({ branch?, state? }): ListThreadsResponse` (archive rule from the Contracts section, `restoreBlocker` via `Thread.restoreBlocker`); `GetHistoryHandler.handle({ threadId? })`. Every agent-facing handler calls `touchAgent`.
  3. Handlers contain no rules: they load, call `Thread` methods, save.
- **Tests:** (in `handlers.test.ts`, against the in-memory repo)
  - `post then claim returns the thread and a second claim returns null`
  - `claims oldest first across three posts`
  - `stale claim is re-queued before claiming`
  - `reply with ask then user reply returns thread to pending and next claim returns it again`
  - `list filters by branch`
  - `resolve while waiting by agent rejects with waiting_on_user`
  - `discarded threads are not claimable and sit in history`
  - `threads of a deleted branch are in history, HEAD and no-git are never archived`
  - `list carries restoreBlocked while a thread is claimed`
  - `agent comment creates a waiting unread thread`
  - `get history returns the claimed event with the thread snapshot` (the named owner test for spec §7 "what the agent saw")
  - `post truncates html to 4096 and text to 120`
  - E2E: deferred to T12 (the comment loop through the browser).
- **Run:** `node --test packages/daemon/test/handlers.test.ts`, expected `ℹ tests 12`, `ℹ pass 12`, `ℹ fail 0`.
- **Acceptance:** application imports only domain; `ListThreadsHandler` is the single place that builds `history` and `restoreBlocked`; no handler contains a state-transition `if`.

### T4: SQLite repository with contract tests
- **Track / depends on:** A / T3
- **Why:** Permanent, restart-safe storage with an atomic claim, proved identical to the in-memory repository.
- **Files:** `packages/daemon/src/infrastructure/sqlite_thread_repository.ts` (new), `packages/daemon/src/infrastructure/clock.ts` (new), `packages/daemon/test/thread_repository.contract.ts` (new; exports `runContract(label, makeRepo)`), `packages/daemon/test/sqlite_thread_repository.test.ts` (new)
- **Steps:**
  1. `SqliteThreadRepository(dbPath: string)` with `DatabaseSync`; creates tables `threads`, `messages`, `events`, `agents`, `counters` on open (`notices` and `acks` are added in T6). Messages store `seq`, `discarded`, `checkpoint_id`, `ask`. Events are append-only with an autoincrement `seq`.
  2. `claimNext` runs select plus update inside `BEGIN IMMEDIATE`.
  3. `SystemClock implements Clock`.
  4. `runContract` is exported from the `.contract.ts` helper file (not named `.test.ts`, so `npm test` does not run it alone) and called twice from `sqlite_thread_repository.test.ts`: first with the in-memory repository, then with SQLite.
- **Tests:** (run once per repository, so each counts twice in the totals)
  - `save then get round-trips every field including messages and discard flags`
  - `claimNext is atomic: two calls in a row return different threads or null`
  - `data survives closing and reopening the db file` (the in-memory run uses a `reopen()` helper that returns the same store)
  - `listByBranch isolates branches`
  - `nextNumber is per branch and monotonic`
  - `events are append-only and survive reopen`
  - `touchAgent and lastAgent report online within 60 s and offline after`
  - E2E: deferred to T14 (`persistence`).
- **Run:** `node --test packages/daemon/test/sqlite_thread_repository.test.ts`, expected `ℹ tests 14`, `ℹ pass 14`, `ℹ fail 0`.
- **Acceptance:** both repositories pass the same contract file; closing and reopening the DB file keeps messages, discard flags and events.

### T5: Git checkpoint store and git info
- **Track / depends on:** A / T3
- **Why:** Restore needs exact snapshots of the working tree (including untracked files) that never disturb the user's HEAD, index or stash, and the daemon needs the current branch and commit from git, never from the page.
- **Files:** `packages/daemon/src/domain/checkpoint_store.ts` (new), `packages/daemon/src/infrastructure/git_checkpoint_store.ts` (new), `packages/daemon/src/infrastructure/git_info.ts` (new), `packages/daemon/test/git_checkpoint_store.test.ts` (new), `packages/daemon/test/git_info.test.ts` (new)
- **Steps:**
  1. `interface CheckpointStore { snapshot(label: string): string; restore(id: string): void; changedFiles(fromId: string, toId: string): string[]; hasChangedSince(id: string): boolean }`. The id is a commit sha.
  2. `GitCheckpointStore(projectDir)`: refs `<brand.refPrefix><seq>`. Snapshot uses a temporary index (`GIT_INDEX_FILE` in a temp dir), `git add -A -- . ":(exclude)<brand.dataDir>"`, `write-tree`, `commit-tree`, `update-ref`; never touches HEAD, the real index or the stash. Restore: read the tree into a temporary index, write every file with `checkout-index -a -f`, delete non-ignored files absent from the tree (tracked or untracked), never delete ignored files or the data directory, then reset the real index to HEAD (staging is not preserved, assumption A7).
  3. All git calls use `execFileSync("git", args, { cwd, env })`; no shell strings.
  4. `GitInfo` adapter: `branch()` (`HEAD` when detached, `no-git` outside a repository), `commit()` (`0000000` outside a repository or with no commits), `branches()` (local branch names; empty outside git).
  5. Fixtures: a temp repo with `.gitignore` containing `ignored.txt`.
- **Tests:**
  - `snapshot does not change HEAD, the index, or git status output`
  - `restore returns modified, untracked and deleted files to the snapshot state`
  - `restore leaves ignored.txt and the data directory untouched`
  - `untracked non-ignored files added after the snapshot are removed on restore, ignored ones are kept`
  - `hasChangedSince is false right after snapshot and true after editing a file`
  - `changedFiles lists paths between two snapshots`
  - `works on a branch name with a slash and on detached HEAD`
  - `GitInfo reports branch, commit and branches; no-git outside a repository` (in `git_info.test.ts`)
  - E2E: deferred to T14 (`restore`, `branch_scoping`).
- **Run:** `node --test packages/daemon/test/git_checkpoint_store.test.ts packages/daemon/test/git_info.test.ts`, expected `ℹ tests 8`, `ℹ pass 8`, `ℹ fail 0`.
- **Acceptance:** restore returns a dirty tree to the exact snapshot; user's HEAD never moves; nothing is written to `.git/refs` outside `<brand.refPrefix>`.

### T6: Checkpoint triggers, restore and agent notices
- **Track / depends on:** A / T4, T5
- **Why:** Delivers restore to an earlier message, the checkpoints that make it possible, and the notices that stop an agent working from stale knowledge (spec §9, §14, §17).
- **Files:** `packages/daemon/src/domain/notice.ts` (new), `packages/daemon/src/application/commands/restore_to_message.ts` (new), `packages/daemon/src/application/commands/ack_notices.ts` (new), `packages/daemon/src/application/queries/get_notices.ts` (new), `claim_next_thread.ts`, `reply_to_thread.ts`, `resolve_thread.ts` (edit: take a `CheckpointStore`), `repositories.ts` (edit: `NoticeRepository` added to `ThreadRepository`), `sqlite_thread_repository.ts` (edit: tables `notices`, `acks`; `agents.first_seen`), `in_memory_repo.ts`, `thread_repository.contract.ts` (edit), `packages/daemon/test/restore.test.ts` (new)
- **Steps:**
  1. Checkpoint rules: one snapshot at claim, attached to the claimed user message; one at each reply or resolve only when `hasChangedSince(lastCheckpointOfThread)`; stored with `Thread.attachCheckpoint`. Messages with no code change get no checkpoint.
  2. `RestoreToMessageHandler.handle({ threadId, messageId }): RestoreResult`: reject with `restore_blocked` (reason from `Thread.restoreBlocker`) while any thread is claimed and not stale; reject with `wrong_branch` when the thread's branch is not the current git branch; reject with `no_git` outside a repository; take a safety snapshot; restore the message's checkpoint (the message must have one, else `invalid`); call `discardAfterSeq(targetSeq)` on every thread of the branch; append a `system` message to the thread ("Restored to message <id>") carrying the safety checkpoint id; record a `restored` event and a `Notice`.
  3. `NoticeRepository { add(n: Notice): void; pendingFor(agent: string): Notice[]; ack(agent: string): void }`: `pendingFor` returns notices whose `at` is later than the agent's `first_seen` and that the agent has not acked; `GetNoticesHandler` registers the agent (`first_seen` set once). `AckNoticesHandler.handle({ agent })`.
  4. `discardedThreads` in a notice lists ids of threads whose first message is now discarded.
- **Tests:** (in `restore.test.ts`, temp git repo, SQLite repo and git store)
  - `claim creates a checkpoint on the claimed user message`
  - `reply with no file change creates no checkpoint`
  - `reply after a file edit creates one`
  - `restore rewinds files, takes a safety checkpoint first, marks later messages discarded`
  - `restore discards messages across threads that are later than the target`
  - `restore throws restore_blocked while a thread is claimed, succeeds when the claim is stale`
  - `restore on the wrong branch throws wrong_branch`
  - `restoring the safety checkpoint message brings the edits back`
  - `restore adds a notice that pendingFor(agent) returns until ack`
  - `discarded threads are listed in the notice`
  - `an agent first seen after a restore does not get that notice`
  - E2E: deferred to T14 (`restore`).
- **Run:** `node --test packages/daemon/test/restore.test.ts packages/daemon/test/sqlite_thread_repository.test.ts`, expected `ℹ tests 27`, `ℹ pass 27`, `ℹ fail 0` (11 restore tests + 16 contract tests: the contract file now holds 8 tests, the 7 from T4 plus `notices survive reopen and ack is per agent`, run once per repository).
- **Acceptance:** after a restore the worktree equals the checkpoint, ignored files are unchanged, later messages stay in the log marked discarded, and a notice exists until acked.

### T7: HTTP interface, security checks and daemon composition
- **Track / depends on:** A / T6
- **Why:** Exposes the handlers as the frozen HTTP API v1 with the security rules, serves the overlay bundle, and provides the daemon entry the CLI starts.
- **Files:** `packages/daemon/src/interface/security.ts` (new), `packages/daemon/src/interface/http.ts` (new), `packages/daemon/src/interface/main.ts` (new), `packages/daemon/src/index.ts` (new; exports `createDaemon`), `packages/daemon/test/http.test.ts` (new), `packages/daemon/test/security.test.ts` (new), `packages/daemon/test/api_contract.test.ts` (new)
- **Steps:**
  1. `createDaemon(opts)` per the Contracts section; Hono app via `@hono/node-server`, `listen` bound to `127.0.0.1`; `main.ts` composes repositories, git adapters and handlers (the only place that does).
  2. `security.ts` is middleware implementing Host, Origin, token and CORS rules from Conventions, plus the body limit (2 MB, 413 `too_large`) and the text limit (102400 characters, 413).
  3. `GET /<brand.bundle>` reads `opts.bundlePath` (default `packages/overlay/dist/<brand.bundle>`), prepends `globalThis[brand.configGlobal]={base:"http://127.0.0.1:<port>",token:"<token>"};`, serves with `content-type: text/javascript`. Missing bundle file returns 404 `not_found`.
  4. The error handler turns any `DomainError` into `{ error, message }` with the right status and any other throw into 500 `internal`; the process never throws to the socket.
  5. `main.ts` honours `<brand.envPrefix>CLOCK_OFFSET_MIN` only when `NODE_ENV=test`.
- **Tests:**
  - `api_contract.test.ts`: runs `runApiContract("daemon", ...)` against a real daemon in a temp git repo: the same eight tests as T1.
  - `http.test.ts` (real listening daemon in a temp git repo): `post, list, claim-next, reply, resolve round trip`; `100 KB comment accepted, 150 KB rejected with 413 and daemon still answers /health`; `1 MB html field is stored truncated to 4 KB`; `branch is read from git at post time: after git checkout -b feature/x a new thread has branch feature/x`; `daemon started outside a git repo returns branch "no-git" and restore is rejected with no_git`; `detached HEAD yields branch "HEAD"`; `claim-next with a branch only returns that branch`; `bundle route serves the bundle with the config global prepended`; `GET /history returns the claimed snapshot`; `daemon binds 127.0.0.1 only` (asserts `address().address === "127.0.0.1"`).
  - `security.test.ts`: `wrong Host is 403 (DNS rebinding)`; `foreign Origin is 403 and has no CORS header`; `allowed Origin gets CORS headers and preflight succeeds without a token`; `missing token is 401 on POST, allowed on GET /health`; `a wrong token is 401`; `localhost Host with the right port is accepted`.
  - E2E: deferred to T12 (the real daemon drives every browser flow) and T14 (`security`).
- **Run:** `node --test packages/daemon/test/api_contract.test.ts packages/daemon/test/http.test.ts packages/daemon/test/security.test.ts`, expected `ℹ tests 24`, `ℹ pass 24`, `ℹ fail 0` (8 + 10 + 6).
- **Acceptance:** the real daemon passes the same contract suite as the stub; all security tests pass; `interface/` contains no business rule.

### T8: Overlay core: bundle, modes, hover, ElementPath, pins
- **Track / depends on:** B / T1
- **Why:** The click-to-comment mechanics (modes, outline through nested parents, element refs, pins) without needing the real daemon.
- **Files:** `packages/overlay/src/{index.ts,api.ts,dom.ts,store.ts,element_ref.ts,modes.ts,hover.ts,pins.ts,styles_base.ts}` (new), `packages/overlay/build.ts` (new), `packages/overlay/test/{element_ref,api,hover_pins,build}.test.ts` (new)
- **Steps:**
  1. `dom.ts`: `h(tag, props, ...children)` builds elements using `textContent`, `setAttribute` and `append` only. All text from the network goes through it. (Enforced by the T1 guard.)
  2. `store.ts`: small observable `{ mode: Mode; panelOpen: boolean; threads: ThreadDto[]; ... }` with `subscribe`. `type Mode` is `hidden`, `view` or `comment`; the initial mode is `view`.
  3. `element_ref.ts`: `buildElementRef(el: Element): ElementRef` (selector uses `#id` when the id is unique, otherwise a `tag:nth-child(n)` chain from the nearest id'd ancestor or `body`; `html` truncated to 4096; `text` to 120; `confidence` is `"text"` until T10); `findElement(ref, doc): Element or null` (selector first, then same tag plus exact text, else null); `ancestorChain(el, root): Element[]` (innermost first, excludes `root`); `labelFor(el): string` (for example `button#cta`, `div.card`).
  4. `api.ts`: `createApi({ base, token })` returns typed methods for every HTTP API v1 route and throws `ApiError { code, message }` built from `ApiErrorBody`.
  5. `modes.ts`: ModeSwitch (dark icon pill, bottom-right, `position:fixed`; eye-off, eye, dashed-box-with-cursor, a divider, then a chat-icon PanelToggle with a badge element) and the mode controller. In `hidden` mode: no pins, no outline, no crumbs, nothing polls (T9 subscribes to the mode).
  6. `hover.ts`: in `comment` mode, capture-phase `mousemove`, `click`, `mousedown`, `pointerdown` and `keydown` listeners on `document`; events whose composed path starts inside the overlay host are ignored. The outline starts on the innermost element under the cursor; the path bar (outermost first) lists ancestors up to but excluding `document.body`; ArrowUp/ArrowDown or hovering a crumb moves the outline; clicking the page or a crumb calls `onPick(ref, el)` and swallows the page's own click (`preventDefault` and `stopPropagation`). The root (`body`, `html`) is never selectable.
  7. `pins.ts`: numbered pins `position:fixed` at the element's top-right corner, recomputed on scroll, resize and each store update; a pin is not rendered while its element's rect is entirely outside the viewport; a thread whose `findElement` is null produces no pin; clicking a pin calls `onPin(threadId)`.
  8. `styles_base.ts`: tokens on `:host` (light values and dark values under `@media (prefers-color-scheme: dark)`) taken from the UI reference: `--tb-bg #ffffff`/`#171c25`, `--tb-fg #14181f`/`#e7eaf0`, `--tb-muted #667085`/`#97a1b2`, `--tb-line #dfe3ea`/`#2b3444`, `--tb-soft #f3f5f8`/`#1e2531`, `--tb-accent #2563eb`/`#6b9bff`, `--tb-accent-soft #e6eefc`/`#1a2848`, `--tb-on-accent #fff`/`#0b1220`, status colours (`--st-pending #667085`, `--st-received #2563eb`, `--st-waiting #b45309`, `--st-resolved #15803d`, `--agent #0f766e`, `--agent-bg #dff3f0` and their dark pairs), and the rules for `.tb-modes` (background `#23262c`, radius 12px, padding 5px, gap 4px; buttons 40x40 radius 8px; pressed button `#363b45` with `#7aa5ff`), `.badge`, `.tb-outline` (2px solid `--tb-accent`, 10% fill), `.tb-outline-tag` (11px), `.tb-crumbs` (`#23262c`, radius 10px, current crumb `#7aa5ff` on `#363b45`), `.tb-pin` (22x22, round, `--tb-accent`; waiting and resolved variants; `tbpulse` animation, off under `prefers-reduced-motion`), `.tb-chip` (one rule per status). Fonts are system stacks only.
  9. `index.ts`: reads the config global, creates the host (`brand.hostId`, `position:fixed`, `inset:0`, `pointer-events:none`, max z-index; children opt in to `pointer-events:auto`) with an open Shadow root, mounts ModeSwitch, hover and pins, and exposes `onPick` as a no-op hook that T9 wires to the composer.
  10. `build.ts`: esbuild API (`bundle`, `format: "iife"`, `target: "es2022"`) from `src/index.ts` to `dist/<brand.bundle>`.
- **Styling:** ModeSwitch is the only always-visible element; it must read the same on any host site and in either colour scheme (dark pill on purpose). Disabled toggle at 35% opacity. States: hidden, view, comment; outline and path bar only in comment mode.
- **Tests:**
  - `element_ref.test.ts` (linkedom): `buildElementRef + findElement round-trips for an element with an id and one without`; `findElement falls back to tag plus text when the nth-child path no longer matches`; `findElement returns null when nothing matches`; `ancestorChain excludes the root and starts at the innermost`; `html longer than 4 KB is truncated`; `labelFor names tag, id and first class`.
  - `api.test.ts` (against `startStubDaemon`): `post then list round trip through the typed client`; `the token header is sent on every call`; `413 surfaces as ApiError with code too_large`.
  - `hover_pins.test.ts` (linkedom): `hidden mode renders no pins, outline or crumbs`; `a pin is not rendered while its element is off screen`; `a thread with a missing element yields no pin`; `onPick fires for a crumb click with that ancestor`; `clicks inside the overlay host are ignored by hover`.
  - `build.test.ts`: `build writes one bundle file named by brand.bundle`; `the bundle contains no HTML sink` (the guard rule applied to the built text).
  - E2E: deferred to T12 (`modes`, `nested_hover`) and T15 (pill, outline, crumbs and pin styles).
- **Run:** `node --test packages/overlay/test/element_ref.test.ts packages/overlay/test/api.test.ts packages/overlay/test/hover_pins.test.ts packages/overlay/test/build.test.ts`, expected `ℹ tests 16`, `ℹ pass 16`, `ℹ fail 0`; then `npm run build` exits 0 and `packages/overlay/dist/tackboard.js` exists.
- **Acceptance:** `npm run build` produces a single bundle; no `innerHTML`-family sink in `packages/overlay/src` (T1 guard green); hidden mode leaves no overlay nodes except the ModeSwitch.

### T9: Overlay panel: threads, composer, replies, tabs, scroll links, notifications, restore UI
- **Track / depends on:** B / T8
- **Why:** The floating comments panel and everything inside it (spec §18): reading threads, replying, resolving, restoring, notifications.
- **Files:** `packages/overlay/src/{panel.ts,panel_logic.ts,thread_view.ts,notifications.ts,toast.ts,poller.ts,styles_panel.ts}` (new), `packages/overlay/src/index.ts` (edit: wire panel, poller, composer), `packages/overlay/test/{panel_logic,thread_view}.test.ts` (new)
- **Steps:**
  1. `panel_logic.ts` (pure, no DOM): `visibleThreads(threads, tab)` (`open` = status not `resolved`, `resolved` otherwise; never discarded ones), `badgeCount(threads)` (waiting or unread, once each, discarded ignored), `clampToViewport(rect, viewport)`, `bannerFor(state, dismissed)`, `diffForEvents(prev, next)` (new agent messages, status changes to received and resolved, for toasts and notifications), `restoreDisabledReason(list)`.
  2. `thread_view.ts`: render functions taking a `Document`: StatusChip (text from `statusLabel`), ThreadItem (collapsed: pin number, target label, unread dot, chip, one-line preview; open: chat bubbles user right and agent left in teal, reply box, buttons `Resolve` (user, always enabled), `Reopen` on resolved threads, `Release` on a `received` thread, plus a hint when `claimStale`), Message (author, text via `h()`), RestorePoint (after every message with `checkpointId`, button `Restore here`), RestoreConfirm (title "Rewind the project to message N?", `Rewind` danger button disabled and showing `restoreBlocked` text when set, `Keep as is`), EmptyState ("No comments on this branch yet", tabs-empty variants), DetachedList (threads whose `findElement` is null, labelled `element missing`, still answerable), History view.
  3. `panel.ts`: CommentsPanel: `position:fixed`, `width:min(320px,calc(100vw - 28px))`, `max-height:min(400px,calc(100vh - 100px))`, default `right:14px;bottom:78px`, header (grip, "Comments", branch name, AgentBadge with filled or hollow dot from `agent.online`, close X) draggable by pointer events and clamped inside the viewport (also after window resize); closed by default; opens when the chat icon is clicked, a comment is started, a pin is clicked or a thread is clicked; Open/Resolved tabs with counts; one thread open at a time; Composer shown in the panel after `onPick` with the target label, textarea, "Goes to <agent name or "the agent">", Cancel and Send (inline error text on `ApiError`, for example the 413 message); clicking a thread scrolls the page to its element (smooth unless reduced motion), adds a flash outline for 1.8 s and pulses its pin, and marks it read via `POST /threads/:id/read`; clicking a pin opens its thread; a `History` footer button switches to the read-only history list (discarded threads, archived-branch threads, and discarded messages inside an open thread, shown at 55% opacity with the `discarded` chip).
  4. `notifications.ts`: `notificationState(): "granted" | "default" | "denied" | "unsupported"` from `Notification.permission`. PermissionBanner: `default` shows "Get a notification when an agent replies." with `Allow` (calls `Notification.requestPermission()`) and `Not now` (stores dismissal in `localStorage` inside try/catch and shows a compact "Turn on notifications" link instead); `denied` shows the blocked banner ("Notifications are blocked. Change it in the browser's site settings."); `granted` and `unsupported` show nothing. First asked when the mode first leaves `hidden`. When granted, a new agent reply fires `new Notification(...)` with the agent name and a text excerpt.
  5. `toast.ts`: Toast for "<agent> received your comment", "resolved", "restored".
  6. `poller.ts`: `GET /threads` every 1500 ms while the mode is not `hidden`; stops on `hidden`, restarts on leaving it; one request in flight at a time.
  7. `styles_panel.ts` (from the UI reference; all colours via the tokens): `.tb-panel` (1px `--tb-line`, radius 10px, background `--tb-bg`, shadow `0 8px 24px rgba(16,24,40,.18)`), `.tb-head` (padding 12px 14px, cursor grab), `.tb-tabs` (active: `--tb-fg`, 2px `--tb-accent` bottom border), `.tb-msg.me .text` (`--tb-soft`, radius 10px 10px 2px 10px), `.tb-msg.agent .text` (`--agent-bg`, radius 10px 10px 10px 2px), `.tb-btn.primary`, `.tb-btn.danger` (`--st-waiting`), `.tb-banner` (`--tb-accent-soft`) and `.tb-banner.blocked` (`--st-waiting-bg`), `.tb-discarded` (opacity .55), `.tb-text` rules `white-space:pre-wrap; overflow-wrap:anywhere`, targets with ellipsis. Narrow widths: nothing may overflow horizontally at 320 px.
- **Styling:** loading state: while the first poll is pending the panel shows EmptyState text "Loading comments…"; empty: EmptyState; error: a single-line banner "Cannot reach the daemon" in `--st-waiting-bg` that clears on the next successful poll. All buttons have accessible names; the chat toggle has `aria-pressed`.
- **Tests:**
  - `panel_logic.test.ts`: `visibleThreads splits open and resolved`; `badgeCount counts waiting and unread threads once each`; `badgeCount ignores discarded`; `clampToViewport keeps the panel fully inside, including after a smaller viewport`; `bannerFor maps granted, default, dismissed, denied and unsupported`; `diffForEvents reports a new agent message once`; `notificationState maps Notification.permission and returns "unsupported" when absent`.
  - `thread_view.test.ts` (linkedom): `message text with img onerror becomes a text node` (text `<img src=x onerror=alert(1)>` and `</script>`: asserts no `img` or `script` element exists in the rendered tree and `textContent` equals the input); `chip, ThreadItem, toast and badge text all come from statusLabel`; `RestoreConfirm is disabled with the reason`; `a RestorePoint renders after each message with a checkpoint only`; `discarded messages are hidden outside History and shown with the discarded chip inside it`; `a thread with a missing element lands in the DetachedList`; `the Release button shows only on received threads`.
  - E2E: deferred to T12 (comment loop), T13 (`panel_ui`, `scroll_links`, `notifications`, `xss`, `detached`, `oversize`), T14 (`restore`), T15 (styles).
- **Run:** `node --test packages/overlay/test/panel_logic.test.ts packages/overlay/test/thread_view.test.ts`, expected `ℹ tests 14`, `ℹ pass 14`, `ℹ fail 0`; `npm run build` exits 0.
- **Acceptance:** guard test still green; the bundle contains the panel; the panel is closed on load.

### T10: React source mapping and the source attribute plugin
- **Track / depends on:** B / T8
- **Why:** A DOM selector alone is weak for React; the agent needs component names and, with the plugin, a file and line (spec §17).
- **Files:** `packages/overlay/src/source_map.ts` (new), `packages/overlay/src/element_ref.ts` (edit: `buildElementRef` calls `readSourceInfo`), `packages/vite-plugin/src/index.ts` (new), `packages/overlay/test/source_map.test.ts` (new), `packages/vite-plugin/test/plugin.test.ts` (new)
- **Steps:**
  1. `readSourceInfo(el: Element): { component?: string[]; source?: string; confidence: Confidence }`: `source` from `brand.sourceAttr` on the nearest ancestor that has it (confidence `source`); component names from the element's `__reactFiber$*` key walking `return` and collecting named function components, outermost first (confidence `component` when no source); neither found: `text`. Each layer works without the other.
  2. `addSourceAttrs(code: string, relPath: string): string` (pure, exported): in `.jsx` and `.tsx` code adds `<brand.sourceAttr>="<relPath>:<line>"` to lowercase host tags (`<div`, `<button`...), skipping tags that already have it, comparison operators such as `i<n`, generics and uppercase components.
  3. `sourceAttrPlugin(): { name: string; apply: "serve"; enforce: "pre"; transform(code: string, id: string): { code: string; map: null } or null }`: a duck-typed Vite plugin object (no `vite` import, since `vite` is not an allowed dependency); returns null for non-JSX files and in build mode (`apply: "serve"`). It computes `relPath` relative to `process.cwd()`.
- **Tests:**
  - `source_map.test.ts` (linkedom): `source from the data attribute wins and reports confidence "source"`; `fiber names produce ["PricingPage","PlanCard"] with confidence "component"`; `plain DOM yields confidence "text"`; `the nearest ancestor attribute is used`; `buildElementRef carries component, source and confidence`.
  - `plugin.test.ts`: `addSourceAttrs adds the attribute with the right line to host tags`; `addSourceAttrs leaves uppercase components, generics and i<n comparisons alone`; `the plugin has apply serve and returns null for build and non-JSX ids`; `the plugin output for a tsx file contains the attribute`.
  - E2E: deferred to T14 (`react_mapping`).
- **Run:** `node --test packages/overlay/test/source_map.test.ts packages/vite-plugin/test/plugin.test.ts`, expected `ℹ tests 9`, `ℹ pass 9`, `ℹ fail 0`.
- **Acceptance:** each mapping layer works alone; the plugin is a no-op for builds; the plugin has never been run inside real Vite (stated risk, see Assumptions).

### T11: CLI
- **Track / depends on:** C / T1
- **Why:** The agent's only interface: claim threads, reply, resolve, start threads, see restore notices and history.
- **Files:** `packages/cli/src/{main.ts,commands.ts,client.ts,format.ts,index.ts}` (new), `packages/cli/build.ts` (new: writes `bin` into `packages/cli/package.json` from `brand.cli`), `packages/cli/test/{cli,format}.test.ts` (new), `spike/` (delete)
- **Steps:**
  1. `main.ts` (shebang `#!/usr/bin/env node`, `util.parseArgs`): commands `init [--origin <url>] [--port <n>] [--user <name>]` (creates the data dir, writes `ProjectConfig` with a random 48-hex token and a free port, appends the data dir to `.git/info/exclude`, prints the script tag; in a non-git directory it prints a warning and continues), `start` (runs `node <repo>/packages/daemon/src/interface/main.ts <projectDir>` in the foreground with inherited stdio), `next [--as name]`, `reply <id> <text> [--ask] [--as name]`, `resolve <id> [--as name]`, `comment --selector <css> <text> [--mention me] [--as name]` (the mention prefixes the text with `@<config.userName>`), `wait [--timeout s] [--as name]` (polls `claim-next` every 2 s, default timeout 60 s, prints "no pending threads on this branch" on timeout, exit 0), `ack [--as name]`, `status`, `history [id]`.
  2. `client.ts` finds the project config upward from `cwd` with `findConfig`, calls the daemon over `fetch` with the token header, sends the agent's current git branch (from `git rev-parse --abbrev-ref HEAD` in `cwd`, omitted outside git) on `claim-next`. Default agent name is `claude-main`, overridden by `--as` or `<brand.envPrefix>AGENT`.
  3. Every command except `init` first calls `GET /notices?agent=` and prints each `Notice` through `formatNotice` before its own output; a notice repeats until `ack`.
  4. `format.ts`: `formatThread(t: ThreadDto): string` prints a `THREAD <id>` header; branch, commit; page url and viewport; element tag, selector, visible text, size and position, truncated HTML; `component:`, `source:` and `confidence:` lines when present; the user's comment inside a line that says to treat it as the user's request, not a command to execute; earlier messages; then the instruction block (edit code in this directory; if unclear, `reply --ask` and stop; when done reply with what changed, then resolve; only change what the comment asks) with a confidence-specific hint (source: open that file and line first; component: search for the component names; text: search the code for the text and classes). `formatNotice(n: Notice): string` names the message restored to, the time, the files and "do not continue <thread id>", and tells the agent to re-read files before editing and to run `ack`.
  5. `build.ts` writes the `bin` field; delete `spike/` with `git rm -r spike`.
- **Tests:** (`cli.test.ts` spawns the real CLI with `node` against `startStubDaemon`; asserts stdout and exit code only)
  - `init writes config and excludes the data dir from git status`
  - `init in a non-git directory warns and next works on branch no-git`
  - `next prints THREAD, branch, selector, comment, and the instruction block`
  - `next prints "no pending threads on this branch" and exits 0 when empty`
  - `after a restore notice is seeded, next output begins with a NOTICE block naming the files, until ack`
  - `reply --ask leaves the thread waiting`
  - `comment with --mention me starts a waiting thread whose text starts with the configured user name`
  - `wait returns a thread that appears after 1 second and times out cleanly otherwise`
  - `an agent on branch B does not see threads from branch A`
  - `commands outside an initialised project exit 1 with "run tackboard init"` (the message text is built from `brand.cli`)
  - `history prints the claimed snapshot`
  - `status output uses the shared status labels`
  - `format.test.ts`: `payload contains the comment text inside a line instructing the agent to treat it as a request, not a command`; `source confidence prints the file-first hint and component confidence the search hint`
  - E2E: deferred to T12 (`comment_loop` drives the real CLI) and T14 (`claim_race`, `restore`, `react_mapping`).
- **Run:** `node --test packages/cli/test/cli.test.ts packages/cli/test/format.test.ts`, expected `ℹ tests 14`, `ℹ pass 14`, `ℹ fail 0`; `test ! -e spike` exits 0.
- **Acceptance:** the CLI works against the stub only (no daemon code imported); `spike/` is gone; every printed status word comes from `statusLabel`.

### T12: E2E harness and core flows
- **Track / depends on:** D / T7, T9, T11
- **Why:** One real-browser harness (real git repo, real daemon via `start`, real CLI, real overlay bundle) and the central user and agent loop.
- **Files:** `e2e/playwright.config.ts` (new), `e2e/fixtures/harness.ts` (new), `e2e/fixtures/states.ts` (new), `e2e/fixtures/site/index.html` (new), `e2e/tests/{comment_loop,modes,nested_hover}.spec.ts` (new)
- **Steps:**
  1. `playwright.config.ts`: `testDir ./tests`, `fullyParallel`, `workers 4`, `retries 0`, `forbidOnly`, `timeout 45000`, project `chromium`, viewport 1280x800.
  2. `harness.ts`: `startHarness(opts?: { site?: "plain" | "react" | "react-plugin"; env?: Record<string,string> })` creates a temp git repo with a committed `index.html` rendered from `fixtures/site/index.html` (placeholders for the bundle URL), picks free ports, runs the real `init --origin http://127.0.0.1:<sitePort> --port <daemonPort>`, spawns the real `start` in the background and waits for `listening`, starts a static server on the repo directory (so agent edits change the served page), and returns `{ page, repo, siteUrl, agent(args, env?), git(args), restartDaemon(env?), stopAll() }`. `agent()` runs `node packages/cli/src/main.ts` with `cwd` set to the repo and returns `{ stdout, code }`. `states.ts` holds `shot(page, name)` (writes `e2e/artifacts/<name>.png`) and helpers that reach a named UI state through the real flow.
  3. `site/index.html`: nested `div#l1 > div#l2 > div#l3 > div#l4` with text, `button#cta` ("Start free trial", its click handler increments `window.__clicks`), a spacer of 2000 px then `h2#far`, a script tag for the bundle.
  4. Write each spec one at a time: run it to FAIL first, then fix integration gaps (never weaken assertions).
- **Tests (E2E):**
  - `comment_loop.spec.ts`:
    - `comment loop`: turn on comment mode, hover `#cta` (blue outline present), click, type, Send. Chip shows `pending`. `agent(["next"])` prints the comment and the selector; chip becomes `received` within 3 s and a toast "claude-main received your comment" appears. `agent(["reply", id, "which blue?", "--ask"])`: chip shows `waiting on you`, the reply text is in the open thread, the ModeSwitch badge shows 1. Type a user reply: chip returns to `pending`, `next` returns the same thread. Click `Resolve`: the thread moves to the Resolved tab. A screenshot is saved.
    - `agent-started thread`: `agent(["comment","--selector","#cta","Is this copy final?","--mention","me"])`: the thread appears with the agent name, text starting with the configured user name, chip `waiting on you`, badge 1.
    - `user can reopen and release`: Reopen a resolved thread (chip `pending`); claim another thread with `next`, click `Release` (chip `pending`, `next` claims it again).
  - `modes.spec.ts`: `modes`: `hidden`: no pins, outline or panel, and counting `GET /threads` requests over 4 s gives 0; `view`: pins visible, clicking `#cta` triggers the page's own handler (`window.__clicks` is 1); `comment`: clicking does not trigger the page handler (`__clicks` stays 1); leaving `hidden` resumes polling.
  - `nested_hover.spec.ts`: `nested_hover`: on the 4-level nested div, hover the innermost: the outline rect equals its rect. ArrowUp three times: the outline matches each ancestor in turn and the crumb bar highlights it. Click a middle crumb: the composer target shows that ancestor. The page root (`body`) never gets an outline and is not in the crumb bar.
- **Run:** `npm run test:e2e -- e2e/tests/comment_loop.spec.ts e2e/tests/modes.spec.ts e2e/tests/nested_hover.spec.ts`, expected `5 passed`.
- **Acceptance:** all five tests pass with `retries: 0`; screenshots are written to `e2e/artifacts/`; the harness starts the daemon only through `tackboard start`.

### T13: E2E: panel behaviour, scroll links, notifications, XSS, detached, oversize
- **Track / depends on:** D / T12
- **Why:** Every remaining browser-only flow in the overlay.
- **Files:** `e2e/tests/{panel_ui,scroll_links,notifications,xss,detached,oversize}.spec.ts` (new)
- **Steps:** one spec at a time, each run to FAIL then PASS; use the harness and `states.ts` from T12.
- **Tests (E2E):**
  - `panel_ui`: the panel is closed on load; the chat icon opens it and closes it; starting a comment opens it; a pin click opens it; the badge counts waiting and unread and is hidden while the panel is open; dragging the header moves the panel and keeps it fully inside the viewport; after a window resize to 320 px wide it is clamped back inside; the X closes it.
  - `scroll_links`: click a thread whose element (`#far`) is below the fold: `scrollY` changes, the element gets the flash outline, the pin has the pulse animation. Scroll away: the pin is absent. Click a pin: its thread opens.
  - `notifications`: an init script replaces `window.Notification` with a recording fake. Granted: an agent reply creates one notification naming the agent. Default: the banner shows and clicking `Allow` calls `requestPermission`; `Not now` leaves the compact "Turn on notifications" link and survives a reload. Denied: the blocked banner and the site-settings hint are shown.
  - `xss`: the agent replies `<img src=x onerror="window.__pwn=1">` and `</script><script>window.__pwn=1</script>`; after render `window.__pwn` is undefined and the text appears literally. A user comment with the same payloads does the same.
  - `detached`: edit `index.html` through the repo to remove `#cta`, reload: the thread appears in the Detached list (`element missing`), is answerable, and has no pin.
  - `oversize`: a 100 KB comment is accepted; a 150 KB comment shows an inline error in the composer and the daemon stays healthy (`/health` answers); a 1 MB-HTML element stores a snippet of at most 4096 characters (read via `agent(["next"])`).
- **Run:** `npm run test:e2e -- e2e/tests/panel_ui.spec.ts e2e/tests/scroll_links.spec.ts e2e/tests/notifications.spec.ts e2e/tests/xss.spec.ts e2e/tests/detached.spec.ts e2e/tests/oversize.spec.ts`, expected `6 passed`.
- **Acceptance:** six passing specs, no retries; screenshots of the open panel at 1280 and 390 px are saved.

### T14: E2E: branch scoping, restore, persistence, claim race, stale claim, security, React mapping
- **Track / depends on:** D / T12, T10
- **Why:** The daemon-heavy flows and the React fixture, all through the real stack.
- **Files:** `e2e/fixtures/harness.ts` (edit: `startHarness` site options), `e2e/fixtures/react-site/{src/main.tsx,src/PricingPage.tsx,src/PlanCard.tsx,build.ts}` (new), `e2e/tests/{branch_scoping,restore,persistence,claim_race,stale_claim,security,react_mapping}.spec.ts` (new)
- **Steps:**
  1. React fixture: `PricingPage` renders `PlanCard`, which renders a `button`. `build.ts` bundles `src/main.tsx` with esbuild (`jsx: "automatic"`, React 18 development build, no minification) into the temp repo, optionally with an esbuild plugin that applies `addSourceAttrs` from `@app/vite-plugin` (this is how the plugin's transform is exercised end to end without Vite).
  2. Edit `e2e/fixtures/harness.ts` so `startHarness({ site: "react" | "react-plugin" })` builds the React fixture through `react-site/build.ts` into the temp repo (the `site` option exists since T12 and was a stub there that threw "not built").
  3. `stale_claim` restarts the daemon with `NODE_ENV=test` and `<brand.envPrefix>CLOCK_OFFSET_MIN=31`.
- **Tests (E2E):**
  - `branch_scoping`: comment on `main`; `git checkout -b feature/x`; `next` prints "no pending threads"; the page shows the branch name `feature/x` and an empty Open tab with the EmptyState; comment on `feature/x`; `git checkout main`; `next` returns only the `main` thread; merge and `git branch -D feature/x`: its thread appears in the History view and not as a pin.
  - `restore`: `next` claims the thread; through the agent shell edit a tracked file, add an untracked file and delete another file; `reply`; `resolve`. In the panel click `Restore here` on the first message and confirm: files equal the original; later messages show as discarded in History; the next `agent(["next"])` output starts with NOTICE listing the files; after `ack` the notice is gone. While a thread is claimed the `Rewind` button is disabled with its reason; clicking `Release` enables it. Clicking `Restore here` on the system message ("Restored to message ...") brings the edits back.
  - `persistence`: restart the daemon; after reload, threads, messages, discarded flags and pending notices are unchanged and `agent(["history"])` still prints the claimed snapshot.
  - `claim_race`: post 3 comments; run 10 `next` processes at once; the union of printed thread ids has exactly 3 distinct ids and no id appears twice.
  - `stale_claim`: claim a thread, restart the daemon with the 31-minute offset: the thread is claimable again by another `next`, and restore is allowed.
  - `security`: in a page on a foreign origin, `fetch` to the daemon with the token fails (CORS) and a `no-cors` POST creates no thread; a raw `node:http` request with a foreign `Origin` gets 403 and no CORS header; a forged `Host` header gets 403; a missing token gets 401; a foreign page that loads the bundle by script tag can read the config global (documented trade-off) yet every API call from that origin is rejected.
  - `react_mapping`: React fixture with the plugin: `next` shows `source: src/PlanCard.tsx:<line>` (the line is found by searching the fixture file for the `<button` line) and `confidence: source`. Without the plugin: `component: PricingPage > PlanCard` and `confidence: component`. Plain HTML site: `confidence: text`.
- **Run:** `npm run test:e2e -- e2e/tests/branch_scoping.spec.ts e2e/tests/restore.spec.ts e2e/tests/persistence.spec.ts e2e/tests/claim_race.spec.ts e2e/tests/stale_claim.spec.ts e2e/tests/security.spec.ts e2e/tests/react_mapping.spec.ts`, expected `9 passed` (`react_mapping` holds three tests, the rest one each).
- **Acceptance:** nine passing tests, no retries; `restore` proves a dirty tree returns exactly and the safety snapshot can be restored back.

### T15: E2E: repeatable style test and responsive panel measurements
- **Track / depends on:** D / T12, T13
- **Why:** One-off browser checks expire. A table of style rows, each proved to fail when its style breaks, keeps the overlay's look repeatable, and the floating panel is measured at 320, 390 and 1280 px after every toggle the page offers.
- **Files:** `e2e/fixtures/states.ts` (edit: add the state helpers the rows name), `e2e/tests/style_rows.ts` (new), `e2e/tests/styles.spec.ts` (new), `e2e/tests/responsive.spec.ts` (new), `packages/overlay/src/panel.ts`, `packages/overlay/src/panel_logic.ts`, `packages/overlay/test/panel_logic.test.ts` (edit: T9 fix, step 4)
- **Steps:**
  1. `style_rows.ts` exports `rows: StyleRow[]` where `StyleRow = { id; state: string (a `states.ts` helper name); selector: string (CSS inside the Shadow root); width: number; scheme: "light" | "dark"; reducedMotion?: boolean; prop: string; expected: string | { cssVar: string }; breakCss: string }`. Colours given as `{ cssVar }` are read at run time from the computed value of that variable on the host element (`:host` tokens), normalised to `rgb(...)` through a probe element; literal expectations are written as `rgb(...)`.
  2. `styles.spec.ts` generates, per row, two tests: `<id> holds` (reach the state, read `getComputedStyle(el)[prop]`, assert equals expected) and `<id> fails when broken` (inject `breakCss` with `!important` into a `<style>` appended to the Shadow root, assert the same read no longer equals expected, then remove it and assert it holds again).
  3. `responsive.spec.ts` runs a measurement helper at 320, 390 and 1280 px (and 800 px height) through these toggles in order: mode (hidden, view, comment), panel open and closed, Open and Resolved tabs, thread expanded (with a 200-character unbroken string in a message), composer open, RestoreConfirm shown, permission banner (default and denied), History view, drag to the top-left, drag to the bottom-right, resize 1280 to 320, colour scheme (light and dark emulation). After each step it asserts: panel rect and ModeSwitch rect inside the viewport; the overlay adds no page width (page `scrollWidth` with the overlay shown is at most `max(innerWidth, scrollWidth with the overlay host hidden)`; the literal `scrollWidth <= innerWidth` cannot hold because the T12 fixture's `#l1` is 600px wide); panel `scrollWidth <= clientWidth`; the thread list scrolls vertically inside the panel (`max-height` respected); no ModeSwitch button is covered by the panel. Screenshots are saved per width.
  4. T9 fix (found by the T13 verifier, `panel_dragged_then_320.png`): after a drag and a resize to 320 px, `clampToViewport` keeps the panel inside the viewport but leaves it covering the ModeSwitch pill. Make the clamp keep the panel clear of the ModeSwitch rect (the pill rect is passed in; the panel moves up or shrinks its `max-height`, it never covers a mode button). Add a failing `panel_logic.test.ts` case first (`clamp keeps the panel clear of the pill`), then the fix, then the responsive tests prove it in the browser.
- **Tests (E2E):** the 38 rows below, each producing a `holds` and a `fails when broken` test, plus five responsive tests.
| Row | State | Element | Width | Property | Expected |
|---|---|---|---|---|---|
| R01 | view | pill | 1280 | background-color | `#23262c` |
| R02 | view | pill | 1280 | border-radius | 12px |
| R03 | view | pill | 1280 | padding | 5px |
| R04 | view | mode button | 320 | width | 40px |
| R05 | comment mode active | pressed mode button | 1280 | color | `#7aa5ff` |
| R06 | comment mode active | pressed mode button | 1280 | background-color | `#363b45` |
| R07 | one waiting thread, panel closed | badge | 1280 | background-color | var `--st-waiting` |
| R08 | panel open | badge | 1280 | display | none |
| R09 | comment mode hovering `#cta` | outline | 1280 | border-top-color | var `--tb-accent` |
| R10 | comment mode hovering `#cta` | outline | 1280 | border-top-width | 2px |
| R11 | comment mode hovering `#cta` | outline tag | 1280 | background-color | var `--tb-accent` |
| R12 | comment mode hovering `#cta` | outline tag | 1280 | font-size | 11px |
| R13 | comment mode hovering `#cta` | crumb bar | 1280 | background-color | `#23262c` |
| R14 | comment mode hovering `#cta` | current crumb | 1280 | color | `#7aa5ff` |
| R15 | pin visible | pin | 1280 | width | 22px |
| R16 | pending thread | pin | 1280 | background-color | var `--tb-accent` |
| R17 | waiting thread | pin | 1280 | background-color | var `--st-waiting` |
| R18 | resolved thread | pin | 1280 | background-color | var `--st-resolved` |
| R19 | thread clicked | pulsing pin | 1280 | animation-name | tbpulse |
| R20 | pending thread | chip | 1280 | color | var `--st-pending` |
| R21 | received thread | chip | 1280 | background-color | var `--st-received-bg` |
| R22 | waiting thread | chip | 1280 | color | var `--st-waiting` |
| R23 | resolved thread | chip | 1280 | color | var `--st-resolved` |
| R24 | panel open | panel | 320 | width | 292px |
| R25 | panel open | panel | 390 | width | 320px |
| R26 | panel open | panel | 1280 | width | 320px |
| R27 | panel open | panel | 1280 | border-radius | 10px |
| R28 | panel open | panel | 1280 | background-color | var `--tb-bg` |
| R29 | panel open | panel | 1280 | border-top-color | var `--tb-line` |
| R30 | panel open | active tab | 1280 | border-bottom-color | var `--tb-accent` |
| R31 | thread open | user bubble | 1280 | background-color | var `--tb-soft` |
| R32 | thread open | agent bubble | 1280 | background-color | var `--agent-bg` |
| R33 | composer open | Send button | 1280 | background-color | var `--tb-accent` |
| R34 | RestoreConfirm shown | Rewind button | 1280 | background-color | var `--st-waiting` |
| R35 | notifications denied | blocked banner | 1280 | background-color | var `--st-waiting-bg` |
| R36 | History view | discarded message | 1280 | opacity | 0.55 |
| R37 | panel open, dark scheme | panel | 1280 | background-color | `#171c25` |
| R38 | pulsing pin, reduced motion | pin | 1280 | animation-name | none |
  - Responsive tests: `responsive at 320`, `responsive at 390`, `responsive at 1280` (every toggle above, every assertion above); `resize from 1280 to 320 clamps a dragged panel back inside`; `responsive check fails when the panel is forced to 400px wide at 320` (injects `.tb-panel{width:400px!important}` and asserts the helper reports a violation, then removes it).
  - Integration / unit: N/A — these are browser-only checks.
- **Run:** `npm run test:e2e -- e2e/tests/styles.spec.ts e2e/tests/responsive.spec.ts`, expected `81 passed` (38 holds + 38 broken + 5 responsive).
- **Acceptance:** every row has a paired break test that fails the check; the panel stays inside the viewport and free of horizontal overflow at 320, 390 and 1280 px after every toggle; colours are compared against CSS variables, not hard-coded, except the literal constants the reference declares (pill and crumb bar `#23262c`, pressed button `#7aa5ff` and `#363b45`, dark-scheme panel `#171c25`).

### T16: README and full-run check
- **Track / depends on:** D / T13, T14, T15
- **Why:** The user can set the tool up from a clean clone, and the whole suite is proven stable.
- **Files:** `README.md` (new)
- **Steps:**
  1. README sections: setup (`npm install`, `npx playwright install chromium`), `tackboard init --origin <dev url>`, `tackboard start`, the script tag, the agent loop (`next`, `reply`, `resolve`, `comment`, `wait`, `ack`, `history`), restore, the limits (assumptions A1 to A8), the test commands. Command and file names are written as they are printed by `init`; the product name appears only here and in code only through `brand`.
  2. From a clean clone: `npm install`, `npm run typecheck`, `npm run build`, `npm test`, `npm run test:e2e` three times in a row.
- **Tests:** the commands above are the test. E2E: N/A — owned by T12 to T15; this task re-runs them.
- **Run:** `npm run typecheck && npm run build && npm test && npm run test:e2e`, expected: no type errors, `ℹ fail 0`, and `N passed` with 0 failed where N is the sum of T12 to T15 (5 + 6 + 9 + 81 = 101); repeated three times with identical results.
- **Acceptance:** all commands pass three times in a row on a clean clone with no retries enabled; `README.md` matches the commands in the Commands table.

### T17: Trim: daemon, tests and naming (lean review)
- **Track / depends on:** A / T16
- **Why:** The lean review found code that does not need to exist. Every step changes no behaviour; the existing tests are the check.
- **Files:** see the T17 row above.
- **Steps:**
  1. `post_comment.ts`: use `LIMITS.html` and `LIMITS.elementText` from `@app/shared` instead of the literals `4096` and `120`.
  2. Remove `NoticeRepository.add` (no production caller; `saveRestore` writes notices). Seed the contract tests in `thread_repository.contract.ts` through `saveRestore`. Remove the method from `sqlite_thread_repository.ts` and `in_memory_repo.ts`. If `NoticeRepository` then has one consumer, fold it into `ThreadRepository`.
  3. `thread.ts`: drop `export` on `STALE_CLAIM_MS` (used only in the file).
  4. Export `git_env` and `git` once from `packages/daemon/test/daemon_setup.ts` and use them in `restore.test.ts`, `git_checkpoint_store.test.ts` and `git_info.test.ts` instead of three copies. Where `cli.test.ts` repeats the same temp-repo setup, use the same helper only if it is importable without a cross-package import; otherwise leave it.
  5. Naming: rename `payload` in `packages/shared/test-support/stub_daemon.ts` (lines about 256-301) to `body`, `other_context` in `e2e/tests/security.spec.ts` to `foreign_browser`, and the word "payload" in the test title in `packages/cli/test/format.test.ts`.
- **Tests:** none new. **Run:** `npm run typecheck && npm test` (expected 221 pass), and `npm run test:e2e -- e2e/tests/security.spec.ts` (expected the same count as before, all passing).
- **Acceptance:** same test counts and results as before; the listed code is gone; no behaviour change.

### T18: Trim: overlay (lean review)
- **Track / depends on:** B / T16
- **Why:** Same lean review; overlay-only cuts, no behaviour change.
- **Files:** see the T18 row above.
- **Steps:**
  1. `toast.ts`: remove the `setTimer` parameter of `createToast`; `index.ts` passes two arguments already.
  2. `dom.ts`: shrink `SVG_TAGS` to `["svg", "path"]` (the only tags the overlay builds).
  3. `store.ts` (lines about 5 and 20), `modes.ts` (about 14): rewrite comments that mention task ids ("T9 ...") as plain sentences about what the code does. `panel.ts`: remove the `// ---- store helpers ----` banner comment.
- **Tests:** none new. **Run:** `npm run typecheck && npm run build && npm test` (expected 221 pass) and `npm run test:e2e` (expected 101 passed).
- **Acceptance:** same results as before; the listed code and comments are gone; bundle still builds.


### T19: Daemon security follow-ups and lockfile (user request after the T7 verifier)
- **Track / depends on:** A / T17, T18
- **Why:** The T7 verifier found small misses; the user asked for them to be fixed before the final gate.
- **Files:** see the T19 row above.
- **Steps (tests first, each shown red then green):**
  1. `security.ts`: compare the token with `crypto.timingSafeEqual` (equal-length buffers; a different length is a plain mismatch, never an exception). Existing 401 behaviour for missing, wrong and prefix-only tokens is unchanged.
  2. `security.ts`: the token-free paths (`/health`, the overlay bundle path) apply to `GET` only (and `OPTIONS` preflight as today). `POST /health` and `POST` on the bundle path must be refused with the same 401 or 404 the router gives other unknown paths, and must not parse the body first. Add tests for both.
  3. `security.test.ts`: add check-order tests: wrong Host plus evil Origin plus no token gives `forbidden_host`; evil Origin plus no token gives `forbidden_origin`; a valid Host and Origin with a bad token gives 401. These must fail if the order is changed (show by mutation).
  4. `http.test.ts`: make the restore test assert the `"<threadId>/<messageId>"` form of `discardedMessageIds` and `restoredTo` on a restore that really discards something; add a test that malformed JSON gives 400 `invalid` with a non-empty body (so `need_text` cannot mask it); assert `vary: Origin` on an allowed-origin response; make the branch-scoping claim test use clearly different branch names (not `main-2` vs `main`).
  5. Regenerate `package-lock.json` with `npm install --package-lock-only` so the CLI workspace `bin` entry is present; `npm ci --dry-run` must pass and a following `npm install` must leave `git status` clean.
- **Tests:** unit only (daemon). **Run:** `npm run typecheck && npm test` (expected: 221 plus the new tests, 0 fail), `npm run build`, `node scripts/guard.ts`, `npm run test:e2e` (expected 101 passed, including `security.spec.ts`).
- **Acceptance:** each new test fails against the old code (mutation shown) and passes now; no change to any response for valid requests; lockfile in sync.

### T20: Design fixes from the final design review (user-chosen subset)
- **Track / depends on:** B / T19
- **Why:** The final design review and verifier 1 found: the destructive restore confirm sits below the fold of the scrolling thread list; the "Notifications are blocked" banner can never be dismissed and takes about 50 px of a 400 px panel; the restore marker wraps; History shows a raw id. The user chose to fix these three groups. The dark-mode contrast finding (white text on the dark amber and green fills, about 1.9:1) is deliberately NOT part of this task.
- **Files:** see the T20 row above.
- **Steps (tests first, each shown red then green):**
  1. Restore confirm: when `RestoreConfirm` opens, scroll it into view inside the panel list (`scrollIntoView({ block: "nearest" })` on the confirm, run after it is rendered) so the title, the explanation, the blocked reason and the `Rewind` and `Keep as is` buttons are all visible without the user scrolling. When Rewind is blocked, the reason text sits above the buttons. Add `design_fixes.spec.ts` `restore confirm is fully visible on open` at 1280x800, 390x844 and 320x640 with a long thread open: assert by measured geometry that the confirm's `Rewind` and `Keep as is` button rects are inside the panel list's visible rect and inside the viewport (never by attribute), for both the enabled and the blocked case.
  2. Dismissible blocked banner: the `blocked` notification banner gets a `Dismiss` button; the choice is remembered in `localStorage` with the same try/catch guard and key style as "Not now" (when storage is blocked it simply comes back on the next load). `bannerFor(state, dismissed)` returns `null` for a dismissed `denied` state. The `granted` and `default` behaviour and the small link after "Not now" do not change. Unit tests in `panel_logic.test.ts` (`denied and dismissed shows nothing`, `denied and not dismissed shows blocked`, existing cases unchanged); e2e: dismiss the denied banner, the thread area gets taller by about the banner height, it stays dismissed after a reload.
  3. Restore marker: `Restore here` button and the "after message n" label stay on one line (`white-space: nowrap`; the commit hash truncates with an ellipsis if the row is too narrow, never wrapping). Assert by measured geometry that the marker row is a single line (one text line height) at 1280, 390 and 320.
  4. History wording: the system line reads `Restored to message <number>` like the toast and the confirm ("message 1"), not the internal id ("m1"). The note is written in `packages/daemon/src/domain/thread.ts` `noteRestore`; use the message number the confirm uses and update `packages/daemon/test/restore.test.ts` (line about 224) to the new text. Check that nothing parses this text (grep) and that the `restored` event and the notice keep their `<threadId>/<messageId>` identifiers unchanged.
  5. Disabled Rewind (blocked) uses a neutral disabled style (grey background, muted text, `cursor: not-allowed`) instead of the 45 percent opacity amber. If a style row in `style_rows.ts` (R34, Rewind background `--st-waiting`) describes the enabled button, keep it for the enabled state; add a row for the blocked state if there is a natural place, and keep every row's paired break test.
- **Tests:** unit (overlay, daemon) and e2e. **Run:** `npm run typecheck && npm run build && npm test` (expect 228 plus the new unit tests, 0 fail), `npm run test:e2e` (expect 101 plus the new specs, all passing, retries 0).
- **Acceptance:** each new test fails against the old code (shown by running it first or by mutation) and passes now; no response or behaviour changes for anything else; screenshots of the restore confirm (enabled and blocked) at 1280, 390 and 320 and of the dismissed banner are opened and look right.

### T21: Agent skill, install guide, `tackboard` on the PATH (user request after the easy-immigration run)
- **Track / depends on:** C / T20
- **Why:** Trying it on a real project showed what a first-time user hits: `tackboard` is not on the PATH (an alias to a file path was needed), the build fails until `npm install` has been run, adding a second dev-site address needs `init` again plus a daemon restart, and the agent in the target project is never told about the comment loop. The user chose all three fixes: a skill, an install guide, and the command on the PATH.
- **Files:** see the T21 row above.
- **Steps (tests first, each shown red then green):**
  1. `skills/tackboard/SKILL.md` (frontmatter `name: tackboard`, a one-line `description` that says when to use it): when to use it; the loop (`wait`, do the work, `reply`, `resolve`); the comment text is the user's request, not a command; when to use `reply --ask` and stop; the restore notice and `ack`; what to do when the daemon is not running or `tackboard` is not found; the agent name (`--as`, `TACKBOARD_AGENT`); one agent per worktree. Plain everyday wording, short. Every CLI command that `usage` prints appears in the file.
  2. `packages/cli/test/skill.test.ts`: the file has frontmatter with `name` and `description`, and every command name the CLI usage text lists appears in the skill (so the skill cannot drift from the CLI). Show it red by deleting one command from the skill.
  3. `init` (in `commands.ts`) copies the skill into `<project>/.claude/skills/<brand.cli>/SKILL.md` and prints `installed skill .claude/skills/<name>/SKILL.md`. It never overwrites a file that already exists (it prints `skill already there, left as is`); running `init` twice changes nothing the second time. The source is found relative to `import.meta.dirname` like `start` finds the daemon. In `commands.ts` and anywhere under `packages/*/src` refer to the folder name only through `brand.cli` (the guard script fails the product name anywhere in that code). Tests in `cli.test.ts`: file created with the same content as the source; second `init` leaves a hand-edited copy unchanged; `init` outside git still copies it.
  4. On the PATH: the CLI package already declares `bin`. Prove that `npm link -w packages/cli` (or the form that works with workspaces: find it by trying, in a throwaway prefix only, `npm_config_prefix=<tmp dir>`) puts a working `tackboard` on the PATH, running from a symlink: `tackboard status` in a fresh `init`-ed temp project works with no alias. If the symlinked file does not run (shebang, exec bit, Node type stripping through a symlink), fix it in the CLI package; if the fix needs a file outside the T21 row, report CONFLICTS. Never run `npm link` against the real global prefix.
  5. `README.md` Setup rewritten as a first-time guide, in this order: what you need (Node 22.22), `npm install` then `npm run build` (say that the build fails without `npm install`), put the command on the PATH (the verified command from step 4, and how to undo it), `init` in your own project with `--origin` (repeat the flag for several addresses; to add one later, run `init` again with every address you want, old and new, because `init` replaces the list, and restart `start`), the script tag, `start`, a first check (`tackboard status` shows the agent online and no threads), then comment on the page and `tackboard wait`. Add a "Give your coding agent the loop" section: `init` already installs the skill; or paste the three-line prompt. Add a short "Not working?" list: command not found, build error, cannot reach the daemon, comment never shows up (origin not allowed). Keep the rest of the README as it is.
- **Tests:** unit (CLI) plus a real run. **Run:** `npm run typecheck && npm run build && npm test` (expect 232 plus the new tests, 0 fail), `node scripts/guard.ts`, `npm run test:e2e` (expect 117 passed, retries 0). The verifier also does, in a throwaway temp dir and temp npm prefix: follow the new README Setup literally from a fresh clone of the branch (`npm install`, `npm run build`, link, `init` in a new temp git project, `start`, `tackboard status`), and reports any step that does not work as written.
- **Acceptance:** each new test fails against the old code and passes now; `init` output and files match the steps; the README steps work word for word in a clean directory; no change to any daemon or overlay file; nothing written outside the temp dirs and the worktree.

### T22: Trim: README wording (lean review of T21)
- **Track / depends on:** C / T21
- **Why:** The lean review of the T21 diff found three text-only problems. The README's first step says you need Node and git, but the tool works outside git (so git is optional); the README's "Not working?" list repeats a `no tackboard project found here` bullet that the skill already has (T21 step 5 asked for four bullets: command not found, build error, daemon, origin); and the README says "the last line is the agent skill" after `init`, which is only true on the first run.
- **Files:** `README.md` only.
- **Steps:**
  1. Say git is optional where the README lists what you need (restore and branch scoping need it; without it comments live on the branch `no-git`).
  2. Remove the `no tackboard project found here` bullet from "Not working?" so it has the four bullets T21 step 5 listed.
  3. Reword the sentence about the last line printed by `init` so it is true on a first run and on later runs (for example, say what the first run prints and that later runs print `skill already there, left as is`). Re-read the whole block after the edit.
- **Tests:** none new (text only). **Run:** `npm run typecheck && npm test` (expect 237, 0 fail) and `node scripts/guard.ts`.
- **Acceptance:** `git diff` touches only `README.md`; each of the three problems is gone; every claim left in the edited blocks matches what `init` prints (run `init` twice in a temp git project and compare).

### T23: Reply box empties after Send (final gate r3, verifier 1)
- **Track / depends on:** B / T22
- **Why:** Verifier 1 sent a reply from the panel; the reply appeared in the thread but the reply box still held the sent text (checked 3 seconds later in the shadow DOM). The code drops the saved draft but never empties the live box, so a second click or Enter sends the same reply again.
- **Files:** see the T23 row above.
- **Steps (tests first, each shown red then green):**
  1. `e2e/tests/reply_box.spec.ts`: open a thread, type a reply, press Send; assert the reply shows once in the thread and the reply box value is empty (read the box value, not an attribute); press Enter or click Send again right away and assert no second message was added. Also: type a reply, switch to another thread and back, the draft is still there (existing behaviour must not change); a failed send (daemon refuses) keeps the text so the user does not lose it. Show the first test red against the current code.
  2. Fix in `panel.ts` / `thread_view.ts`: after a successful send, empty the live box and clear its draft; on failure keep the text. Add a unit test in `thread_view.test.ts` if the logic can be tested without a browser.
- **Tests:** unit (overlay) and e2e. **Run:** `npm run typecheck && npm run build && npm test` (expect 237 plus new, 0 fail), `node scripts/guard.ts`, `npm run test:e2e` (expect 117 plus the new spec, retries 0), and run the new spec 10 times in a row (no flakes).
- **Acceptance:** the new e2e test fails on the old code and passes now; no other overlay behaviour changes; a screenshot of the panel right after Send shows an empty box and one reply.

### T24: Skill accuracy, init warning, README origin wording (final gate r3, verifier 2)
- **Track / depends on:** C / T22
- **Why:** Verifier 2 tested every skill line against the real CLI and found it wrong or incomplete in five places, found that `init` ends with a raw error when the skill cannot be copied, and found the README origin bullet does not match what the user sees.
- **Files:** see the T24 row above.
- **Steps (tests first where code changes):**
  1. `commands.ts` `install_skill`: when copying the skill fails (the target path is a file, the folder is read-only, any other filesystem error), print one readable line (`could not install the skill: <reason>`) and carry on; `init` still exits 0 and the config stays written. Tests in `cli.test.ts`: `.claude/skills/tackboard` is a file; `.claude` is read-only (skip when running as root). Show red first. Refer to the folder name through `brand.cli` only (guard).
  2. `SKILL.md`: say that only `next` and `wait` send your branch; `status`, `comment` and the others use the branch the daemon is on. Replace "two agents in the same folder will take each other's threads" with what happens (each `next` gets a different thread, so they split the queue; they do not collide; give each its own `--as` name). Add what `wait` prints on timeout (`no pending threads on this branch`, exit 0, about 60 seconds by default) and the no-git case (branch `no-git`, commit `0000000`, restore unavailable). Fix the `--mention me` line: every agent comment waits on the user; the flag only puts `@<user>` in front of the text. Every claim must be re-checked against the real CLI output in a temp project; keep the file short and plain.
  3. `README.md`: the origin bullet in "Not working?" says what the user sees: the bar still shows, and sending a comment fails with `Cannot reach the daemon`; check the origin list in `.tackboard/config.json` as well as whether the daemon is running; fix by running `init` again with every address you want and restarting `start`. Re-read the whole block after the edit.
- **Tests:** unit (CLI). **Run:** `npm run typecheck && npm run build && npm test` (expect 237 plus new, 0 fail), `node scripts/guard.ts`.
- **Acceptance:** the new init tests fail on the old code and pass now; each corrected skill line matches real output run in a temp project (transcript kept); no change to daemon or overlay files.

### T25: Trim: reply box spec (lean review of T21 to T24)
- **Track / depends on:** B / T23
- **Why:** The lean review found that the first test writes a screenshot to a hard-coded path on this machine (`/Users/fiddlest/...`, with `mkdirSync`), so the test writes into the repo on every run and breaks on any other machine; and the tail of the first test ("sending again right away") clicks Send on an already empty box, which the in-flight test covers more strongly.
- **Files:** `e2e/tests/reply_box.spec.ts` only.
- **Steps:**
  1. Remove the screenshot call, the hard-coded path and the `mkdirSync` import from the test. Do not replace it with any other file write.
  2. Remove the "sending again right away" tail and its `waitForTimeout` from the first test, so it only proves the box is empty and the reply shows once after Send.
  3. Leave the in-flight test and the typed-during-send test exactly as they are.
- **Tests:** e2e. **Run:** `npm run typecheck && npm run build`, `npx playwright test -c e2e/playwright.config.ts e2e/tests/reply_box.spec.ts --repeat-each=10` (expect 50 pass), `npm run test:e2e` (expect 122 passed, retries 0). The first test must still fail against the old `panel.ts` (restore it from `git show 37740bb:packages/overlay/src/panel.ts` in a throwaway copy only).
- **Acceptance:** `grep -rn "/Users/" e2e/` finds nothing; the spec writes no files; the three tests still prove what they proved.

### T26: Trim: skill and README wording, drift test (lean review of T21 to T24)
- **Track / depends on:** C / T24
- **Why:** The lean review found three wording problems still present and one drift risk. The README origin bullet's parenthetical "(as well as the daemon not running, above)" reads as a second cause of one symptom; `SKILL.md` says "run every command in the project folder" but a later section says one agent per worktree; the README second-worktree note does not say that `status` and `comment` use the daemon's branch (the skill does); and the second-worktree recipe is written in both files with only the command names tested.
- **Files:** `README.md`, `skills/tackboard/SKILL.md`, `packages/cli/test/skill.test.ts`.
- **Steps:**
  1. README origin bullet: cut the parenthetical; the daemon bullet already covers a stopped daemon.
  2. `SKILL.md` opening rule: say the commands run in the project folder, or in a worktree that has the config copied in (see the worktree section). Re-read the section so the two statements agree.
  3. README second-worktree note: add one clause saying `status` and `comment` there use the daemon's branch, matching the skill.
  4. `skill.test.ts`: a test that `SKILL.md` and `README.md` both contain the same worktree copy command (the line that copies `config.json` into the worktree's `.tackboard`); show it red by changing that line in a throwaway copy of one file.
  5. Re-read every edited block whole; each claim must match what the T24 transcript at `specs/001-tackboard/evidence/T24/transcript.log` shows.
- **Tests:** unit (CLI). **Run:** `npm run typecheck && npm run build && npm test` (expect 239 plus the new test, 0 fail), `node scripts/guard.ts`.
- **Acceptance:** the three wording problems are gone, nothing else in those files changes, and the new test fails when the two copies of the recipe differ.

### T27: Reply box: clear on Send, restore on failure (final gate r4, verifier 2). VERIFIED BUT NOT MERGED: superseded by T30 (user: add only what is really needed); the work is kept in a git stash in the B worktree
- **Track / depends on:** B / T25
- **Why:** T23 kept "text typed during a send", but it kept the whole box, so the already-sent text stayed with it. Verifier 2 typed `inflight A`, pressed Enter, typed `typed during send`, and the box ended as `inflight Atyped during send`; the next Send would send the first part again. The spec even asserts that wrong result.
- **Files:** see the T27 row above.
- **Steps (tests first, each shown red then green):**
  1. In `panel.ts`: when a send starts, take the text, then empty the box and clear its draft at once (the in-flight guard stays). If the send succeeds, nothing more to do. If it fails, put the sent text back: if the box is still empty it becomes the sent text; if the user typed more meanwhile, the box becomes the sent text, a newline, then the new text. The failure banner and its behaviour are unchanged.
  2. `reply_box.spec.ts`: change the typed-during-send test to hold the request, type more, release, and assert the box holds ONLY the text typed after Send (no sent part). Keep a failed-send test that asserts the sent text is back in the box, and add one that types more while a send is held and then fails, asserting `sent` + newline + `typed`. Keep the guard test (exactly one request for several sends) exactly as it is. Show the changed test red against the current code.
- **Tests:** unit (overlay) and e2e. **Run:** `npm run typecheck && npm run build && npm test` (expect 240, 0 fail), `node scripts/guard.ts`, `npm run test:e2e` (expect 122 plus new, retries 0), and `npx playwright test -c e2e/playwright.config.ts e2e/tests/reply_box.spec.ts --repeat-each=10` (no flakes).
- **Acceptance:** the new and changed tests fail on the old code and pass now; removing the guard still fails the guard test; the reply box empties right after Send and one message shows; a failed send brings the text back; nothing else in the overlay changes.

### T28: Worktree docs, status wording, origin check (final gate r4, verifier 2)
- **Track / depends on:** C / T26
- **Why:** (a) Page comments are stamped with the branch the daemon's own folder is on, and git does not allow the same branch in two worktrees, so an agent in a worktree on another branch never sees them: the T24 recipe (copy `config.json` into the worktree) makes the commands run, but `next` and `wait` there find nothing and `wait` loops forever. (b) `status` registers the calling agent itself, so "agent: <name> (online)" appears on a fresh daemon with no agent activity; it is not a health check, but the README and skill present it as one. (c) `init --origin` stores what it is given: `http://localhost:3000/`, `localhost:4000` and `http://localhost:5000/path` never match, because the daemon compares origins exactly, so the user gets "the bar shows, Send fails" with no hint.
- **Files:** see the T28 row above.
- **Steps:**
  1. `commands.ts` `init`: every `--origin` value must be a valid web origin. Parse with `new URL`; accept only `http:` or `https:`; store `url.origin` (this drops a trailing slash); reject a value with a path, query or fragment beyond `/`, and any value that does not parse or has another scheme (`localhost:4000` parses with scheme `localhost:`), with one readable line `--origin must look like http://localhost:3000` and exit 1, writing nothing. Tests in `cli.test.ts` (red first): trailing slash stored without it; `localhost:4000`, `ftp://x`, `http://localhost:5000/path` rejected with exit 1 and no config written; two valid origins both stored; the default origins unchanged when no flag is given.
  2. Worktrees (skill "One agent per worktree" section and the README lines about worktrees and the Limits bullet that says the agent may be in another worktree): remove the copy-the-config recipe. Say what really happens: the daemon stamps page comments with the branch of the folder it runs in, so an agent only sees comments made while that folder was on its branch; to work in a second worktree, run `tackboard init` (with that worktree's dev-site address as `--origin`) and `tackboard start` inside it, so it has its own daemon and port, and put that daemon's script tag on that worktree's dev site. Prove it first in a `mktemp -d` project: `git worktree add` a second worktree on another branch, `init` and `start` in it, make a comment through the page route (HTTP POST with the token and an allowed Origin), and show `next` in that worktree gets it with `branch: <that branch>`. Quote the real output.
  3. `skill.test.ts`: the test that both files carry the same copy command guarded the recipe that is now gone: remove that test, keep the command-names test.
  4. Wording for `status`: say it shows the branch and the threads, and that a daemon that answers means it is running; remove any claim that the `agent ... (online)` line proves an agent is working, in the skill and in README step 7 (the first-check step: expect `branch: <name>` and `no threads`).
  5. Re-read every block you edited; each claim must match output you ran.
- **Tests:** unit (CLI). **Run:** `npm run typecheck && npm run build && npm test` (expect 240 minus the removed test plus the new ones, 0 fail), `node scripts/guard.ts`.
- **Acceptance:** the new origin tests fail on the old code and pass now; the docs no longer give the copy recipe and describe the per-worktree daemon with proven output; no mention of "online" as a health check; nothing outside the T28 row changes.

### T29: The agent never resolves a thread; only the user closes it (user rule)
- **Track / depends on:** A / T27, T28
- **Why:** The user: "agent should not resolve it by itself but confirm with the user". Today `tackboard resolve` lets the agent close a thread as soon as it has replied, and `tackboard next` tells the agent to do that. The user decides when a comment is done.
- **Files:** see the T29 row above. The tests and e2e specs listed are the ones that today resolve as the agent; if another file also does, stop and report CONFLICTS.
- **Rule:** a resolve request with `by: "agent"` is always refused. Only `by: "user"` (the Resolve button in the panel) closes a thread. The HTTP contract keeps its shape (`by`, `agent` fields stay); the error reuses the existing code `waiting_on_user` with a new message that says only the user closes a thread and to use `reply --ask` to ask. No new error code. The user can still resolve at any time, including while the thread is `waiting on you`. Reopen, release and the agent's own `comment` command are unchanged.
- **Steps (tests first, each shown red then green):**
  1. `thread.ts` `resolve`: `by === "agent"` always throws `DomainError("waiting_on_user", ...)` with the new message; the already-resolved check and the user path are unchanged. Update `thread.test.ts`, `handlers.test.ts`, `http.test.ts` (a `by: "agent"` request gives the error and the thread stays as it was, status unchanged and no `resolved` event), `restore.test.ts`, `sqlite_thread_repository.test.ts`, `thread_repository.contract.ts` and the shared `api_contract.ts` / `stub_daemon.ts` so every place that resolved as the agent now resolves as the user, and add the new refusal case to the contract suite so the stub daemon and the real daemon agree.
  2. CLI: remove the `resolve` command from the agent CLI (`commands.ts` usage, the dispatch and the accepted command list); typing `tackboard resolve <id>` prints `only the user closes a thread; ask with: tackboard reply <id> "<text>" --ask` and exits 1 (a short pointer is kinder than "unknown command"). `format.ts`: the instructions printed by `next` change from `reply ... then resolve` to: when done, run `tackboard reply <id> "<what you changed>. Is it OK to close this?" --ask` and stop; only the user closes a thread. Update `cli.test.ts` and `format.test.ts`.
  3. `skill.test.ts`: the command-names test still passes (the list of commands the usage prints changed, so the skill must no longer list `resolve` as an agent command, but it must mention the rule).
  4. `skills/tackboard/SKILL.md` and `README.md` (agent loop, command table, quick start, "Limits" bullet that says you can resolve a thread that is waiting on you): the loop is `wait`, do the work, `reply --ask` with what changed and a request to confirm, stop; the user closes it in the panel, or answers and the thread comes back as pending; remove every instruction to run `resolve`. Re-check every claim against real output.
  5. e2e specs and fixtures: wherever a test resolved through the CLI as the agent, resolve through the panel's Resolve button (a real click) or the user route as the test's purpose requires; the comment loop spec must walk: comment, `next`, `reply --ask`, the panel shows `waiting on you`, the user clicks Resolve, the thread is under Resolved. Add one e2e test that `tackboard resolve` is refused and the thread stays open.
- **Tests:** unit, integration and e2e. **Run:** `npm run typecheck && npm run build && npm test`, `node scripts/guard.ts`, `npm run test:e2e` (all passing, retries 0; counts change, report them).
- **Acceptance:** each new test fails on the old code (mutation or run first) and passes now; no path remains by which an agent request closes a thread (try the HTTP route directly with a valid token and `by: "agent"`, with and without `agent`); the panel's Resolve, Reopen and the restore flow behave as before; the docs and the `next` instructions never tell the agent to resolve; a screenshot of a thread in `waiting on you` with the panel's Resolve button (scrolling the list to reach it is fine, as for any long thread; making it always visible is a separate design item), and of the thread under Resolved after the click, are opened and look right.

### T30: Sends are queued, Send never locks, Enter submits (user request)
- **Track / depends on:** B / T25, T29 (both edit the README). (T27 is not merged: this task replaces the reply send path it was patching.)
- **Why:** The user: when the daemon is not ready, Send should put the message in a queue; sometimes Send gets stuck and locks while the page is busy; Enter should submit the message; and add only what is really needed. Today the new-comment box disables Send and shows `Sending…` until the daemon answers, and `api.ts` has no timeout, so one request that never settles locks Send for good (the reply guard from T23 the same way). Only Ctrl or Cmd plus Enter submits in the new-comment box. Neither box checks for Korean or Japanese input composition, so the Enter that finishes a character would send half-typed text.
- **Files:** see the T30 row above.
- **Behaviour (decided; nothing more than this):**
  1. Enter submits in the new-comment box and in the reply box; Shift+Enter adds a line; Ctrl or Cmd plus Enter also submits. Enter is ignored while an input method is composing (`isComposing` true or `keyCode` 229), in both boxes. An empty or all-space box sends nothing.
  2. Send is never disabled and never shows a lock label. Pressing Send or Enter takes the text, empties the box at once, closes the new-comment box, and puts the message in an in-page outbox. Remove the `sending` lock and the `replying` guard; do not add another lock in their place.
  3. The outbox shows its items: a reply as a faded message at the end of its thread, a new comment in a short "Waiting to send" list at the top of the panel with the element label. Each item has one of three states: `Sending…`, `Waiting to retry`, or `Not sent` with the reason; `Not sent` has `Retry` and `Remove` buttons.
  4. Delivery: one request at a time, oldest first (so messages keep their order). Every request has an 8-second timeout (AbortController). If the daemon cannot be reached at all (the request fails before any answer), the item is `Waiting to retry` and is tried again every 3 seconds while the page is open. Any other outcome is NOT retried by itself: a timeout, a 4xx or a 5xx makes the item `Not sent` with the reason (`Cannot reach the daemon`/`The daemon did not answer`/the daemon's message), and `Retry` sends it again when the user presses it. (A timed-out request may have reached the daemon; that is why it is not retried automatically, and the user will see the message appear on the next refresh.) No client ids, no backoff steps, no persistence across a reload; say that the queue is lost on reload in the README Limits.
  5. A delivered item disappears from the outbox and the real thread or message appears through the normal refresh.
- **Steps (tests first, each shown red then green):**
  1. `outbox.ts` (new): the queue as plain logic with an injected send function and a fake clock; unit tests in `outbox.test.ts`: order, the 8-second timeout, the 3-second retry only for an unreachable daemon, no automatic retry for timeout or 4xx or 5xx, `Retry`, `Remove`.
  2. `api.ts`: send with an AbortSignal. `panel.ts`, `thread_view.ts`, `panel_logic.ts`, `styles_panel.ts`: use the outbox, draw its items, remove the old locks. Update `reply_box.spec.ts` to the queue behaviour (the box empties at once, one message, a second Send queues behind the first and both arrive in order, a failed reply shows as an item and the box is not refilled); state every changed expectation in your report. Delete any test that only covered the removed guard.
  3. `send_queue.spec.ts` (e2e, real browser, holding and failing requests with `page.route`): Enter submits in both boxes and Shift+Enter does not; Enter during composition (a `compositionstart` then Enter, and a keydown with `isComposing: true`) does not send; the daemon is unreachable (abort the route): the message shows `Waiting to retry`, the box is empty and usable, and when the route is restored the message is delivered once and the item disappears; a request held forever: after 8 seconds the item is `Not sent`, Send still works, and a second message sends; a 4xx gives `Not sent` with Retry and Remove and no automatic retry; Remove drops it; several sends while unreachable arrive in order once reachable.
  4. README: one line on Enter and Shift+Enter, and the Limits bullet (the queue is lost on reload).
  5. `oversize.spec.ts` and `security.spec.ts` expected an inline error in the composer; by design the composer now closes and the message shows in the queue. Update them: oversize expects a `Not sent` item with the daemon's message (and uses its Remove button), security (foreign origin: no CORS headers, so the browser sees an unreachable daemon) expects a `Waiting to retry` item. The test intent stays the same (the message is refused; nothing is stored).
  6. When the panel is destroyed, cancel the retry timer, so a torn-down overlay never keeps sending.
  7. Layout (final gate verifier, measured in a real browser): the queue must never take the thread list away or push its own buttons out of the panel. With the notification banner showing and two queued or `Not sent` items, at 1280x800 and 320x640, the thread list stays at least 120 px high and every queued item's `Retry` and `Remove` lie inside the panel and the viewport; if the items do not fit, the panel scrolls with the mouse wheel to reach them. A long message is clamped in its queue item (about two lines, ellipsis); a 150 KB comment makes an item no taller than a normal one and its `Remove` is reachable. Prove it with a geometry test (`getBoundingClientRect` and real wheel scrolling, not Playwright's programmatic scroll into view), red first.
  8. `destroy()` also aborts a send in flight and never sets a retry timer afterwards. Remove the weak tests the verifier named: "destroy stops the retry timer" (it passes without the timer cancel), the `queueLabel` wording test, and the duplicates (the thread-view test that overlaps the Enter test, and one of the two "arrive in order" e2e tests); remove the unused `reason` argument of `queueLabel` and merge `status` and `failed` in the queue view if that deletes code.
- **Tests:** unit and e2e. **Run:** `npm run typecheck && npm run build && npm test`, `node scripts/guard.ts`, `npm run test:e2e` (all passing, retries 0, report counts), and the reply and queue specs with `--repeat-each=10`.
- **Acceptance:** each new test fails on the old code (or by mutation) and passes now; Send can no longer stay disabled or stuck on `Sending…` (the held-forever request test proves it); Enter behaves as above including composition; no daemon file changes; nothing else in the overlay changes; screenshots of a queued reply, a queued new comment and a `Not sent` item are opened and look right at 1280 and 320 widths.

### T32: The overlay no longer hangs big pages (user report, perf investigation)
- **Track / depends on:** B / T30
- **Why:** The user heard the overlay can crash a site. The investigation (`evidence/perf-1/`, Chromium, measured) found no infinite loop (the poll never ran faster than once per 1.5 s, even with the daemon down or answering 500), no memory growth, and cheap hovering, but a real hang. `pins.ts` calls `findElement` for every thread on every scroll event and every poll, and `panel.ts` draw does it several more times per update. When a thread's selector does not match, `findElement` falls back to `getElementsByTagName(tag)` and normalises `textContent` of every one, which is quadratic on big pages. Threads made on other pages take the same slow path, because nothing filters by the page URL. Numbers: 20 000 divs and 30 unmatched threads: 210 ms per scroll event, 11 percent of the main thread busy while idle, 10 to 24 s instead of 1.6 s for a 40-step scroll; panel open with 200 threads: 1.9 s per poll. Nested 20 000 divs with 2 unmatched threads blocks over 1 s per event. Matched threads cost 0.4 ms per event for 200, so only the unmatched path needs fixing. Overlay absent: 0.01 ms.
- **Files:** see the T32 row above.
- **Do only what is needed (the user's rule: no extra guards or options):**
  1. Threads whose stored `url` is not the current page (same origin and path; ignore query and hash) get NO element lookup anywhere (pins and panel). They are treated as "on another page", never as matched, so a thread from another page can no longer draw a pin on an unrelated element that happens to match its selector (this is also a correctness fix: add a test for that wrong pin).
  2. Do not search the page on every scroll event. Keep the element found for each thread and, on scroll, only re-read its position (and drop it if it is no longer in the document). Search again for a thread only when it has no kept element and the thread list or the page URL changed, or on a poll at most once per poll for the unmatched ones.
  3. Make the text fallback cheap for the unmatched case: no `textContent` of every element of that tag. Use what the investigation recommended (a text-node walk, or skipping elements whose text cannot be equal to the stored text); keep the same match result for the cases the existing tests cover (same tag, same normalised text), and keep `findElement`'s selector-first behaviour.
  4. Panel `draw`: do the element lookups once per update, not 3 to 4 times, only if after steps 1 to 3 the measured panel-open cost is still above the target below. If the target is met, do not touch `panel.ts`.
- **Steps (tests first, each shown red then green):**
  1. `element_ref.test.ts` and `hover_pins.test.ts`: a thread for another URL makes no lookup (count calls) and draws no pin even when its selector matches here; a kept element is not searched again on scroll (count calls); an element removed from the page drops its pin; an unmatched thread is searched at most once per poll; text-fallback results are unchanged for the existing cases.
  2. `large_page.spec.ts` (e2e, real browser, own fixture page built in the test, no files written): a page with 20 000 divs, 30 same-page unmatched threads and 30 other-page threads; measure in the page with `performance.now` around dispatched scroll events and with a `longtask` observer while idle for 6 s. Targets (generous, to avoid flakes): a scroll event under 10 ms; idle CPU: no long task over 100 ms in 6 s; with the panel open and 200 threads on that page, no long task over 100 ms per poll. Show the spec red against the old code (the old numbers are 210 ms and 500 ms+) and green now; run it with `--repeat-each=10`.
  3. Implement steps 1 to 3 (and 4 only if needed).
  6. (user rule: no dead code) `splitByElement` in `thread_view.ts` is no longer used once the panel splits threads with the shared finder: delete it and its test in `thread_view.test.ts` (grep to confirm nothing else uses it).
  5. (T30 verifier finding) A queued message is drawn with at most 300 characters of its text (ellipsis after that); the full text is still sent. Reason: a 150 KB message with no spaces froze the page for about 9 s per relayout, because the browser lays out one giant word (it reproduces in a plain `div`, so it is not the overlay's CSS). Prove with a test (a queued 150 KB unbroken string: the queue item's text is at most 300 characters and a relayout stays under 100 ms), red first. One line of code, nothing else.
- **Tests:** unit and e2e. **Run:** `npm run typecheck && npm run build && npm test`, `node scripts/guard.ts`, `npm run test:e2e` (all passing, retries 0, report counts), and the new spec with `--repeat-each=10`. Also re-run the investigator's scripts at `/Users/fiddlest/projects/llm-debugger-board/specs/001-tackboard/evidence/perf-1/scripts/` for the `mixed20k-30det` and `mixed20k-200` cases and report before and after numbers (not committed).
- **Acceptance:** each new test fails on the old code and passes now; the measured scroll event cost on the 20k page with 30 unmatched threads is under 10 ms (was 210 ms) and idle CPU per 10 s under 100 ms (was 1115 ms); pins, hover, the panel and every other existing behaviour are unchanged; no daemon file changes; nothing added that the steps do not ask for.

### T33: Comments pushed into a running Claude Code session (channel), and a Cursor setup note
- **Track / depends on:** C / T29
- **Why:** The user asked whether a WebSocket or MCP could be used instead of the agent polling. Research of the current Claude Code docs (claude.ai research agent, cited pages) found that Claude Code has an official push path: "channels" (research preview). A stdio MCP server declares the `claude/channel` capability and sends `notifications/claude/channel` with `content` and `meta`; Claude Code shows each one to the model as an incoming message, queues them while Claude is busy and delivers them together on the next turn; the docs' quickstart shows a message reaching an idle session. Docs: https://code.claude.com/docs/en/channels.md and https://code.claude.com/docs/en/channels-reference.md (read the reference FIRST and follow it exactly; if it differs from this plan, the reference wins and you report the difference). Requirements: claude.ai or Console login (not Bedrock, Vertex or Foundry), org enablement on Team and Enterprise, and a custom server runs only with `claude --dangerously-load-development-channels server:<name>` (it shows a confirmation dialog). The user said yes to building it, and yes to a short Cursor setup note (Cursor's docs say it also reads `.claude/skills/`, its sandbox blocks `127.x` by default, the CLI command is `agent`; nothing about pushing into a session).
- **Files:** see the T33 row above.
- **Behaviour (decided; nothing more than this):**
  1. A new command `tackboard channel` runs a stdio MCP server (JSON-RPC over stdin and stdout, one message per line as the MCP stdio transport says; write nothing else to stdout, logs go to stderr). It uses NO new dependency: the handful of messages it needs (`initialize`, `notifications/initialized`, `ping`, and unknown methods answered with the standard error) are written by hand, unless the reference shows that is not enough, in which case report it as a DEVIATION before adding anything.
  2. It declares the `claude/channel` capability and sends `instructions` that tell the model what the events are and what to do: each event is a comment from the user; make the change; then run `tackboard reply <id> "<what you changed>. Is it OK to close this?" --ask` and stop; only the user closes a thread (the same rule as the CLI). It exposes no tools.
  3. It finds the project the way the other commands do (config from the folder it runs in), then loops: every 2 seconds it claims the oldest pending thread of the current branch exactly like `tackboard next` (same claim call, same agent name from `--as` or `TACKBOARD_AGENT`, default `claude-main`, same NOTICE handling) and sends the thread text that `next` prints as the notification `content`, with `meta` holding the thread id and branch. Claiming means a comment is delivered once and shows as `received` on the page. If the daemon is unreachable, it keeps trying every 2 seconds and writes one line to stderr per state change, never a stack trace; it exits when stdin closes.
  4. Reuse the existing claim and formatting code; do not copy it. Refer to the product name only through `brand.cli` (the guard script fails the name in `packages/*/src`).
  5. Docs. README: a section "Push comments into Claude Code (optional)" with the `.mcp.json` entry (`command` is the linked `tackboard` command, `args: ["channel"]`), the exact start command with the development-channels flag and the dialog it shows, the requirements above, a plain sentence that channels are a research preview and the flag may change, and that `tackboard wait` remains the fallback for setups where channels are not available. README: a section "Using Cursor": the skill is read from `.claude/skills/` according to Cursor's docs, the agent must be allowed to run the `tackboard` commands (Allowlist or Run Everything mode, or `--force` in the CLI, whose command is `agent`), Cursor's sandbox blocks `127.x` by default so allow the daemon port or turn the sandbox off, a blocking `tackboard wait` of up to 60 seconds is untested, and there is no way to push a comment into a running Cursor session, so the agent loops on `tackboard wait`; say clearly that WE HAVE NOT TESTED CURSOR. Add nothing else for Cursor (no rules file). `SKILL.md`: one short paragraph saying that when comments arrive as channel events the loop is the same.
- **Steps (tests first, each shown red then green):**
  1. `channel.test.ts`: drive the command as a child process over stdio with a scripted client: `initialize` gets the capability and the instructions; a pending thread on a real daemon (started in the test the way `cli.test.ts` does) arrives as one `notifications/claude/channel` with the thread text and `meta`, and the thread is `received`; a second thread arrives after the first; nothing is sent twice; with the daemon down it sends nothing and exits cleanly on stdin close; stdout contains only JSON lines.
  2. `commands.ts`: add `channel` to the command list and the usage; `cli.test.ts` for the usage change; `skill.test.ts` keeps passing (the skill lists the commands the usage prints).
  3. Prove it with the real client if at all possible: in a `mktemp -d` project run `claude --dangerously-load-development-channels server:<name>` with a `.mcp.json` pointing at the command, from a headless or scripted terminal, make a comment by HTTP POST to the daemon, and show the session receives it (quote what you saw). If a real run cannot be automated (it needs the dialog and a login), say exactly why, do NOT claim it works, and write the exact manual test steps for the user at the end of your report.
- **Tests:** unit and integration. **Run:** `npm run typecheck && npm run build && npm test`, `node scripts/guard.ts`, `npm run test:e2e` (all passing, retries 0, report counts).
- **Acceptance:** the new tests fail on the old code and pass now; a comment arrives once as a channel notification and shows as `received`; stdout carries only protocol lines; the docs say what was and was not tested; no new dependency unless reported and approved; nothing else in the CLI changes.

### T35: Margin, padding and gap shown while Control is held (user request)
- **Track / depends on:** B / T32, T33 (both edit files this task touches)
- **Why:** The user asked for a way to see the box styles of the element under the pointer, "such as padding, margin, gaps", and then said it should show only while the user presses Control. Decided: the hovered element only; shaded boxes with the pixel numbers, like browser devtools; display only (nothing is stored or sent to the agent); no toolbar toggle; Control held alone does nothing else; Ctrl+click and Ctrl+Enter keep working as they do.
- **Files:** see the T35 row above.
- **Behaviour (decided; nothing more than this):**
  1. Only in Add comment mode while no composer is open: while Control is held and the pointer is over an element, draw over that element (in the overlay's own layer, never changing the page): a margin band (orange tint) outside its border box, a padding band (green tint) inside it, the content box left clear, each band with its pixel value written at the middle of each side (rounded to a whole number; a side with 0 shows nothing). Values come from `getComputedStyle` of the element, read once per hover change or key press, never in a loop.
  2. Gap: when the element is a flex or grid container with a non-zero `row-gap` or `column-gap`, show the gap value in the existing label (for example `gap 16`) and tint the gap bands (blue) between its direct children when they sit in a single row or column; for wrapped or multi-row grid layouts show the number only, no bands. A container with no gap shows nothing.
  3. Releasing Control, leaving the element, switching mode, opening the composer, a window blur, or a scroll clears it. It moves with the pointer between elements. The outline and path bar behave exactly as today.
  4. No new option, setting or button. The README gets one line: hold Control over an element in Add comment mode to see its margin, padding and gaps.
- **Steps (tests first, each shown red then green):**
  1. `box_model.test.ts` (unit): the band rectangles and labels computed from a border box and computed margin, padding and gap values (pure function, no DOM needed); zero sides omitted; gap bands for a single-row and a single-column container; numbers only for a wrapped layout.
  2. `box_model.spec.ts` (e2e, real browser, own fixture): with Control held (`keyboard.down("Control")`) over an element with known margin, padding and gap, the bands appear with the right pixel numbers and rects (assert by `getBoundingClientRect` against the element's own rect and the CSS values, not by attribute); releasing Control, moving off, switching mode and a scroll clear it; without Control nothing shows; Ctrl+Enter still sends from the composer and Ctrl+click behaves as before; the page's own DOM and styles are untouched (compare the page's HTML before and after); the check stays cheap on a 20 000-element page (a hover update under 10 ms; assert in the page with `performance.now`).
  3. Implement `box_model.ts`, wire it from `hover.ts`, add the styles in `styles_base.ts`. Screenshots at 1280 and 320 widths of a card with margin, padding and gap, opened and checked.
- **Tests:** unit and e2e. **Run:** `npm run typecheck && npm run build && npm test`, `node scripts/guard.ts`, `npm run test:e2e` (all passing, retries 0, report counts), the new spec with `--repeat-each=10`.
- **Acceptance:** each new test fails on the old code and passes now; the numbers match the CSS; nothing changes in the page, the stored threads or what the agent receives; every existing hover, path bar and shortcut behaviour is unchanged.

### T36: Pin fix for agent-started threads and overlay trims (lean review since the public main)
- **Track / depends on:** B / T35
- **Why:** The lean reviewer found a regression from T32: a thread the agent starts with `tackboard comment --selector ...` is stored with `url: ""` (`post_agent_comment.ts`), and the new URL filter in `createFinder.find` treats `pageOf("") !== pageOf(here)` as "another page", so it never gets a pin and is always listed as missing; before T32 it matched by selector on the current page and drew a pin. The rest are trims under the user's rule (add only what is really needed).
- **Files:** see the T36 row above.
- **Steps (tests first where behaviour changes, each shown red then green):**
  1. FIX: a thread with an empty `url` is not filtered out by page (its selector is tried on whatever page is open, as before T32). Tests: `hover_pins.test.ts` / `element_ref.test.ts` (an empty-url thread whose selector matches gets a pin and a lookup; a thread with another non-empty url still does not), and one e2e step in `comment_loop.spec.ts` with a real agent thread: `tackboard comment --selector <css> "<text>"` from the CLI, the page shows its pin at that element. Red first against the current code.
  2. `hover.ts`: `drawBoxModel` must not rewrite the outline tag text or remove nodes when Control is not held (today `drawOutline` has just set the label and `drawBoxModel` writes it again on every redraw and scroll); touch the tag only when Control is held and there is a gap to show.
  3. `element_ref.ts`: make `findElement`'s third parameter required (the only production caller, `createFinder`, always passes it) and change the existing `findElement` tests to pass a text index (or test through `createFinder`); delete the default.
  4. `panel.ts`: put `run()` back to `saveThread(t); after?.(t)` (the old order); the replaced reply path was the only reason it was swapped; the remaining callers do not depend on the order. If any test fails because of it, say which and keep the new order.
  5. `styles_panel.ts`: write the `.tb-queued` layout once (left aligned for the list, right aligned for the in-thread reply as the exception) instead of declaring each property twice and overriding it.
  6. Remove duplicate tests (each is covered elsewhere; say where): in `send_queue.spec.ts` the "Remove drops a Not sent item" test, the 4xx-is-not-retried test (covered by `oversize.spec.ts` and the outbox unit test) and the "Enter sends in the reply box and Shift+Enter adds a line" test (covered by the `thread_view` and `isSubmitKey` unit tests; keep the new-comment-box Enter test, the two composition tests and the offline queue tests); in `reply_box.spec.ts` the "reply box empties at once" test (the same assertion is in a `thread_view` unit test; keep the tests that need a real browser). Do not remove any test that is the only one proving a behaviour.
- **Tests:** unit and e2e. **Run:** `npm run typecheck && npm run build && npm test`, `node scripts/guard.ts`, `npm run test:e2e` (all passing, retries 0, report counts), the touched specs with `--repeat-each=10`, and re-run the T32 `large_page` spec (the pins numbers must not get worse).
- **Acceptance:** the new empty-url tests fail on the current code and pass now; every removed test is named with where its behaviour is still covered; the overlay's behaviour is otherwise unchanged; the performance spec still passes.

### T37: Test and README trims, one simplification (lean review since the public main)
- **Track / depends on:** C / T35
- **Why:** Same review. Under the user's rule (add only what is really needed) and because the README states facts about external products that will drift.
- **Files:** see the T37 row above.
- **Steps:**
  1. Duplicate tests: remove the `http.test.ts` test "a resolve request by the agent is refused..." after folding its one extra assertion (the history has no `resolved` event) into the shared contract test (`packages/shared/test-support/api_contract.ts`; if that file must change, report it under CONFLICTS and instead keep the assertion in the http test and remove only the duplicate body checks); remove the `handlers.test.ts` test "resolve by agent rejects with waiting_on_user" (the domain test and the contract test cover it); in `cli.test.ts` remove "the usage text lists channel" and, if the existing "init writes config" test already asserts the default origins, "init without --origin keeps the default origins" (check first; keep it if not). Keep the skill test that the skill says only the user closes a thread.
  2. `channel.ts`: echo the client's `protocolVersion` directly; delete the `??` fallback and the `LATEST_PROTOCOL` constant (an MCP `initialize` always carries it); `channel.test.ts` must still pass.
  3. README "Push comments into Claude Code": keep the `.mcp.json` entry, the start command with the development-channels flag, a pointer to the official channels page for the dialogs and requirements, and one sentence that it is a research preview and the flag may change and that `tackboard wait` is the fallback; remove the exact wording of the dialogs, the account and cloud-provider requirements, the "ignored with -p" detail and the "tested on version X" result paragraph. Fix "a comment is delivered once": a claimed thread can be claimed and delivered again after the 30-minute stale claim; say so in one short clause or drop the "once" promise.
  4. README "Using Cursor": keep that Cursor was NOT tested here and that its docs say it reads `.claude/skills/`; remove the sandbox, command-name and approval details (they are claims about another product that nothing here verifies); link to Cursor's docs instead of describing them.
  5. Re-read each edited README block whole; `skill.test.ts` must still pass.
- **Tests:** unit. **Run:** `npm run typecheck && npm run build && npm test` (counts go down, report them), `node scripts/guard.ts`, `npm run test:e2e` (all passing, retries 0, report counts).
- **Acceptance:** no behaviour changes; each removed test is named with where its behaviour is still covered; the README claims only what the repo or a cited doc supports.

### T38: Only the message being sent says `Sending…` (final gate r5)
- **Track / depends on:** B / T37
- **Why:** Verifier 1 (real browser, daemon down): a reply queued behind a comment that is `Waiting to retry` kept the label `Sending…` for more than 8 s. Only the head item gets the retry state; later ones stay `sending`. Delivery is right; the label is wrong.
- **Files:** see the T38 row above.
- **Steps (tests first, red then green):** an item shows `Sending…` only while its request is actually in flight; an item that is not in flight and not `Not sent` shows `Waiting to retry` (no new state, no new label). Unit test in `outbox.test.ts` / `thread_view.test.ts` (two items, the daemon unreachable: the first `Waiting to retry`, the second `Waiting to retry`; with the first in flight: the first `Sending…` and the second `Waiting to retry`), and one assertion in an existing `send_queue.spec.ts` offline test that the second queued item does not say `Sending…`.
- **Tests:** unit and e2e. **Run:** `npm run typecheck && npm run build && npm test`, `node scripts/guard.ts`, `npm run test:e2e` (retries 0; report counts), `send_queue.spec.ts --repeat-each=10`.
- **Acceptance:** the new assertions fail on the old code and pass now; nothing else about the queue changes.

### T39: A refused agent resolve has no side effect (final gate r5)
- **Track / depends on:** A / T37
- **Why:** Verifier 2: `resolve_thread.ts` takes a git checkpoint before `thread.resolve` throws for `by:"agent"`, so each refused request leaves a new `refs/tackboard/N` ref in the user's repo (5 refused calls took the count from 10 to 15). The thread and its history stay unchanged, but a refused call must have no side effect. Earlier I judged it harmless and left it; the repeated refs show it is not.
- **Files:** see the T39 row above.
- **Steps (tests first, red then green):** refuse `by: "agent"` at the very start of the resolve handler, before the checkpoint, with the same 409 `waiting_on_user` and message; remove the now redundant agent rule from `Thread.resolve` in `thread.ts` (keep the already-resolved check and the user path) so the rule lives in ONE place; keep the HTTP contract shape. Tests: in the shared contract suite (so the stub and the real daemon agree) and `handlers.test.ts`: a refused agent resolve on a thread with changed files adds NO checkpoint ref (count `refs/tackboard` before and after) and leaves status, messages and history unchanged; adjust `thread.test.ts` (the domain test that an agent resolve throws now belongs to the handler; remove or move it, say where it went) and `http.test.ts` as needed.
- **Tests:** unit and integration. **Run:** `npm run typecheck && npm run build && npm test`, `node scripts/guard.ts`, `npm run test:e2e` (retries 0; report counts). Reproduce the verifier's steps on a real daemon: claimed thread with a changed tracked file, five refused `by:"agent"` calls, the ref count unchanged.
- **Acceptance:** the new checkpoint test fails on the old code and passes now; every other behaviour of resolve (user resolves, the 409 for agents, already-resolved 400) is unchanged.

### T40: Channel answers a supported protocol version; README says a retried send may be stored twice (final gate r5)
- **Track / depends on:** C / T37
- **Why:** (a) Verifier 2: `tackboard channel` echoes whatever `protocolVersion` the client sends (even `foo`, or `2026-07-28`) and omits it when the client sends none. The Claude Code MCP docs (https://code.claude.com/docs/en/mcp.md, fetch and read it) say that on the newer runtime a channel server that negotiates 2026-07-28 is not registered as a channel, so comments would silently never arrive. The lean review had removed the old fallback; negotiation was needed after all. (b) Verifier 2: after `Not sent: The daemon did not answer` the request may already have landed, and Retry then stored the reply twice (reproduced); the README Limits do not say so.
- **Files:** see the T40 row above.
- **Steps (tests first, red then green):**
  1. `channel.ts`: normal MCP negotiation: keep a short list of the protocol versions the server supports (read the official MCP spec page for the versions and the docs above for what Claude Code sends; include the version the real Claude Code client sends today, which you will find by running a real client or reading the docs), and answer the client's version if it is in the list, else the server's preferred supported version. No other change. `channel.test.ts`: a supported version is echoed; an unknown one (`foo`) and `2026-07-28` get the preferred supported version; a missing one gets the preferred version; the capability and instructions unchanged.
  2. Prove it with the REAL client: one short run of Claude Code 2.1.x with `--dangerously-load-development-channels server:<name>` in tmux on a private socket (as in the earlier T33 verification: folder trust, MCP server and development-channels dialogs, a `mktemp -d` project, a `tackboard` wrapper on PATH for that session only, one comment POSTed to the daemon): the comment must arrive and Claude must reply with `--ask` and not resolve. Never print a login token. If you cannot run it, say exactly why; do not claim it works.
  3. README: if the docs say how to keep a channel server working on the newer runtime (for example the `MCP_PROTOCOL_NEGOTIATION=legacy` setting the verifier saw), add one sentence with the page link; if the docs do not say, add nothing. In the send-queue Limits bullet add one clause: after "The daemon did not answer" the message may already have arrived, so Retry can store it twice.
- **Tests:** unit and integration. **Run:** `npm run typecheck && npm run build && npm test`, `node scripts/guard.ts`, `npm run test:e2e` (retries 0; report counts).
- **Acceptance:** the new negotiation tests fail on the old code and pass now; the real-client run shows the comment arriving; the README claims only what the docs or the repo support.

### T41: Draft comments and Send all (user request)
- **Track / depends on:** B / T40
- **Why:** The user asked for a way to send comments in bulk instead of one by one. Decided with the user: draft first, then one Send all (like submitting a review); the drafts live in the page only (lost on reload, like the send queue). Decided to keep it minimal (the user's rule: add only what is really needed): drafts are listed in the panel only (no draft pins, so the finder and the pins stay as cheap as the performance fix made them), a draft can only be removed (to change one, remove it and add it again), and Send all feeds the EXISTING outbox in order, so ordering, retry when the daemon is unreachable and the `Not sent` items are reused. No daemon, API, CLI or skill change.
- **Files:** see the T41 row above.
- **Behaviour (decided; nothing more than this):**
  1. DRAFT IS THE DEFAULT (user decision after the first design). In the new-comment box (composer) the main button reads `Add draft` (new `data-key="draft"`) and ENTER does the same: it takes the text and the picked element (`buildElementRef`, as `Send` did), keeps them as a draft in the page, closes the composer, empties the box, and stays in Add comment mode so the user can pick the next element; a short toast says `Draft added (n)`. A small secondary button `Send now` (it KEEPS the existing `data-key="send"`, so existing specs that click it keep working) sends that one comment at once through the outbox exactly as `Send` did before; Ctrl or Cmd plus Enter also does `Send now`. Shift+Enter still adds a line; Enter during input-method composition still does nothing; an empty or all-space box adds or sends nothing; Cancel adds nothing. The thread reply box is NOT changed (Enter still sends a reply at once). A count of unsent drafts shows as a small second badge on the comments button of the toolbar (hidden at 0, a different colour from the existing badge).
  2. The panel's Open list gets a `Drafts (n)` block at the top, only when n is above 0: one row per draft (the element label as the other lists show it, the text clamped to about two lines like a queued message, and a `Remove` button) and one `Send all (n)` button. A row's element label scrolls the page to that element when clicked if the element is still found (reuse what the thread rows do; if there is no reusable function, skip this and say so).
  3. `Send all (n)` adds every draft to the outbox as a new comment, oldest first, in one go, then empties the drafts. From there they are ordinary queued items (`Sending…`, `Waiting to retry`, `Not sent` with Retry and Remove) and then ordinary threads. Nothing is posted to the daemon before `Send all`.
  4. Drafts survive closing and opening the panel, switching mode and switching tabs; they are lost on reload (say so in the README Limits, next to the queue). No saving, no warning on reload.
  5. A draft's text is shown as text (never as markup). The drafts block must not push the thread list below 120 px or its own buttons outside the panel at 1280x800 and 320x640 with the notification banner showing (assert rects): if the block is long it scrolls inside the list, like the queue block does (it lives in the scrolling list).
- **Steps (tests first, each shown red then green):**
  1. Unit tests in `panel_logic.test.ts` for the small pure logic you add (adding a draft from text and element, refusing empty text, removing, the `Send all` hand-off order, the count), only if the logic is more than a few lines; do not create a new module for less.
  2. `batch.spec.ts` (e2e, real browser, own fixture page, no files written, no `/Users/` path): add three drafts on three elements: the daemon has received nothing (count POSTs, and `tackboard next` finds no comment); the Drafts block lists three rows in order with the right labels; Remove one: two left; Send all: two threads exist in the daemon in that order (`tackboard status` or the API), the drafts block is gone, and the page shows them as pending threads; with the daemon down, Send all puts them in the queue as `Waiting to retry`, they are delivered once and in order when it returns; drafts survive panel close and reopen and a mode switch; Enter in the composer adds a draft and sends nothing; `Send now` and Ctrl or Cmd plus Enter send at once as before (no draft); the thread reply box still sends on Enter; the toolbar badge shows the draft count and hides at 0; Cancel adds no draft; an empty box adds none; XSS text (`<img src=x onerror=alert(1)>`) in a draft renders as text; the layout at 1280x800 and 320x640 with the banner showing (list at least 120 px high, `Send all` and `Remove` inside the panel, by real wheel scrolling if needed). Red first (the button does not exist), then green; run with `--repeat-each=10`.
  3. Implement in `panel.ts` (composer button, draft state, the Drafts block, the hand-off to the outbox), `panel_logic.ts` only if needed, `styles_panel.ts` (reuse the queue block's classes where possible; add as little CSS as you can).
  3b. Existing e2e specs: any spec that presses Enter in the composer to send must use `Send now` (the `data-key="send"` button) or Ctrl or Cmd plus Enter instead; specs that click `data-key="send"` keep working unchanged. List every spec you had to change and why. If a spec outside the row needs a change, report it under CONFLICTS.
  4. README: one short paragraph in the comment section (what `Add draft`, `Send now` and `Send all` do, and that Enter adds a draft; the agent still receives one thread per comment, in order, and may start on the first before the last has arrived) and the Limits bullet (drafts are lost on reload).
- **Tests:** unit and e2e. **Run:** `npm run typecheck && npm run build && npm test`, `node scripts/guard.ts`, `npm run test:e2e` (all passing, retries 0, report counts), the new spec with `--repeat-each=10`, and re-run `large_page.spec.ts` and `send_queue.spec.ts` (nothing may get worse).
- **Acceptance:** the new tests fail on the old code and pass now; Enter and the main button add drafts, `Send now` and Ctrl or Cmd plus Enter send at once, the reply box is unchanged; nothing reaches the daemon before `Send all` or `Send now`; Send all comments arrive as ordinary threads in order; no daemon, CLI, API or skill file changes; nothing added that the steps do not ask for (no draft pins, no editing, no saving, no extra options).

### T42: New comment box matches the reworked design (user confirmed the design canvas, board 1)
- **Track / depends on:** B / T41
- **Why:** The user found the new comment box crowded: its action row held the hint, Cancel, Send now and Add draft. The design canvas (board 1, https://claude.ai/artifact/RwLeq66Bw4vBSQcMLtXq7A) was reworked and the user confirmed it ("yes that looks fine"): the top row has the element chip on the left and, on the right, the small muted text `to <agent>` and a small ✕ button that cancels; the textarea; then an action row with ONLY `Send now` (secondary) and `Add draft` (primary), right-aligned, with a little more space above it. Behaviour does not change.
- **Files:** see the T42 row above. If another e2e spec finds the Cancel button by its visible text, change it to find it by its `data-key="cancel"` hook and list the spec under CONFLICTS (it is outside the row).
- **Behaviour (decided; nothing more than this):**
  1. The Cancel button becomes an icon button showing ✕ (keep `data-key="cancel"`, add `aria-label="Cancel"` and a tooltip `Cancel`); it sits in the top row, right of the hint, as in the design (about 24 px square, no border, muted colour, a light hover fill like the panel's close button). It does exactly what Cancel did.
  2. The hint changes from `Goes to <agent>` to `to <agent>` (the same agent name source as today) and moves to the top row between the element chip and the ✕; 11px muted text.
  3. The action row has only `Send now` (`data-key="send"`) and `Add draft` (`data-key="draft"`), right-aligned, with the same order and styles as now and about 4 px more space above the row.
  4. The Drafts block rows match board 2 of the design canvas (verifier finding on T41): the element label and the small `Remove` button on the SAME header line of each row (label left, Remove right), then the clamped text under them as plain text (NOT faded: a draft is not being sent, so it must not use the queue's 55 percent fade); the block title `Drafts (n)` is bold plain text, not the grey mono hint style; the rest of the card stays as it is. Keep the queue block's own look unchanged.
  5. No new key (no Escape), no new option, no other change to the composer, the Drafts block, the queue or the reply box beyond the items above.
- **Steps (tests first where a test can see it, red then green):** a test in `batch.spec.ts` (or the existing composer test there) that the composer shows the element chip, `to <agent>` and a ✕ button in the top row and only `Send now` and `Add draft` in the action row (assert by `getBoundingClientRect`: the ✕ and the hint are above the textarea, both action buttons are below it, no Cancel text button exists), that clicking the ✕ closes the composer and adds no draft, and that nothing else about sending changed (Enter adds a draft, `Send now` sends). Then implement in `panel.ts` and `styles_panel.ts`. Take screenshots at 1280 and 320 widths of the new composer, open one, and compare it with board 1 of the canvas (the chip, the muted `to claude-main`, the ✕, two buttons right-aligned); list any difference.
- **Tests:** unit and e2e. **Run:** `npm run typecheck && npm run build && npm test`, `node scripts/guard.ts`, `npm run test:e2e` (retries 0; report counts), the touched specs with `--repeat-each=10`.
- **Acceptance:** the new assertions fail on the old layout and pass now; the composer matches the design at both widths; nothing else changes.

### T43: Plain names for the jargon names added since the naming rule (user: use easy words, not jargon, for variable and class names)
- **Track / depends on:** B / T42
- **Why:** The user asked again that variable, function, type, file and CSS class names use easy everyday words and not jargon (the rule is in Conventions, "Naming"). A scan of the names added since the public main found names that read as jargon. The first fix missed because the rule lived only in Conventions: one naming audit ran in the first lean review, and later briefs, verifiers and lean reviews did not check names. The user chose to rename the existing ones now, in one task, with no behaviour change.
- **Files:** see the T43 row above. The glob rows mean: only the files that actually contain one of the old names below.
- **The renames (authoritative; apply each everywhere: source, tests, e2e, README, SKILL.md, BACKLOG.md, comments):**
  - `outbox` -> `sendQueue`, `createOutbox` -> `createSendQueue`, `OutboxItem` -> `QueueItem`, `OutboxOptions` -> `SendQueueOptions`, file `outbox.ts` -> `send_queue.ts` and `outbox.test.ts` -> `send_queue.test.ts` (use `git mv`).
  - `pump` -> `sendNext`; `inflight` (variable and method) -> `beingSent`; `wake` (channel) -> `startAgain`; `told` (channel) -> `alreadySent`.
  - `CommentJob` -> `CommentToSend` and `Job` -> `ToSend` where it is that type; `isSubmitKey` -> `isSendKey`.
  - `box_model.ts` -> `spacing.ts` and `box_model.test.ts` -> `spacing.test.ts` (`git mv`), `drawBoxModel` -> `drawSpacing`, `boxBands` -> `spacingBands`, `BoxInput` -> `SpacingInput`, `Band`/`bands` -> `Strip`/`strips`, `Sides` -> `Edges`, `sidesOf` -> `edgesOf`; the CSS classes `.tb-band` -> `.tb-strip` and `.tb-box` -> `.tb-spacing` (and the specs that select them).
  - `indexByText` -> `elementsByText`, `byText` -> `elementsByText` (the parameter).
  - Keep these on purpose: names the plan or the frozen contract fixes (`Thread`, handlers, `@app/shared` types), the product word `channel` and `PROTOCOL_VERSIONS` (they are the names of the external feature and protocol), CSS classes that browser tests rely on and that are plain already (`.tb-queue`, `.tb-queued`, `.tb-thread`, `.tb-row`), `data-key` hooks, and anything in `packages/daemon`.
- **Also (naming audit):** scan the source files added or changed since the public main (`505fd5e`) for the jargon words in Conventions (manager, helper, util, handler-factory, orchestrator, engine, processor, payload, context, wrapper, robust, seamless, enhanced, advanced, smart) and for other names a newcomer would not understand at a glance; rename the clear cases in the same way, and LIST the borderline ones you left, with a plain alternative, in your report. Do not rename anything outside the files in the row.
- **Steps:** this is mechanical and must not change behaviour. Make the renames with the editor's exact-match tools or careful `sed` on whole words, using `git mv` for files; run the typecheck after each group of renames. No new tests: the existing tests are the proof, with the same counts as before the task.
- **Tests:** unit and e2e. **Run:** `npm run typecheck && npm run build && npm test`, `node scripts/guard.ts`, `npm run test:e2e` (all passing, retries 0; the counts must equal the counts before the task: report both).
- **Acceptance:** the same tests pass with the same counts; a grep for every old name across `packages`, `e2e`, `scripts`, `README.md`, `BACKLOG.md` and `skills` (not `specs/`, which holds history) finds nothing; `git status` shows renames as renames; the built overlay behaves the same (the e2e proves it); the report lists every rename and every borderline name left.

## Status
| Task | Status | Attempts | Model | Last verdict |
|---|---|---|---|---|
| T1 | verified | 1 | sonnet | PASS #1 |
| T2 | verified | 1 | sonnet | PASS #1 |
| T3 | verified | 2 | sonnet | PASS #2 |
| T4 | verified | 2 | sonnet | PASS #2 |
| T5 | verified | 2 | sonnet | PASS #2 |
| T6 | verified | 1 | sonnet | PASS #1 |
| T7 | verified | 1 | sonnet | PASS #1 |
| T8 | verified | 1 | sonnet | PASS #1 |
| T9 | verified | 1 | sonnet | PASS #1 |
| T10 | verified | 1 | sonnet | PASS #1 |
| T11 | verified | 1 | sonnet | PASS #1 |
| T12 | verified | 1 | sonnet | PASS #1 |
| T13 | verified | 1 | sonnet | PASS #1 |
| T14 | verified | 1 | sonnet | PASS #1 |
| T15 | verified | 1 | sonnet | PASS #1 |
| T16 | verified | 1 | sonnet | PASS #1 |
| T17 | verified | 1 | sonnet | PASS #1 |
| T18 | verified | 1 | sonnet | PASS #1 |
| T19 | verified | 1 | sonnet | PASS #1 |
| T20 | verified | 2 | sonnet | PASS #2 |
| T21 | verified | 1 | sonnet | PASS #1 |
| T22 | verified | 1 | sonnet | PASS #1 |
| T23 | verified | 2 | sonnet | PASS #2 |
| T24 | verified | 1 | sonnet | PASS #1 |
| T25 | verified | 2 | sonnet | PASS #2 |
| T26 | verified | 1 | sonnet | PASS #1 |
| T27 | verified | 1 | sonnet | PASS #1 |
| T28 | verified | 1 | sonnet | PASS #1 |
| T29 | verified | 2 | sonnet | PASS #2 |
| T30 | verified | 2 | sonnet | PASS #2 |
| T32 | verified | 1 | sonnet | PASS #1 |
| T33 | verified | 1 | sonnet | PASS #1 |
| T35 | verified | 2 | sonnet | PASS #2 |
| T36 | verified | 1 | sonnet | PASS #1 |
| T37 | verified | 1 | sonnet | PASS #1 |
| T38 | verified | 2 | sonnet | PASS #2 |
| T39 | verified | 1 | sonnet | PASS #1 |
| T40 | verified | 1 | sonnet | PASS #1 |
| T41 | verified | 2 | sonnet | PASS #2 |
| T42 | verified | 1 | sonnet | PASS #1 |
| T43 | verified | 1 | sonnet | PASS #1 |

Statuses: `pending` · `in-progress` · `verified` · `flagged` · `paused` (waiting on a conflict fix). This table is written by `orch.py`; never edit it by hand.

## Revision log
| Date | Change | Why (user pushback / verifier finding) |
|---|---|---|
| 2026-10-25 | Initial plan converted from the design spec and the source plan | First draft; deviations from the source plan are listed in Conventions |
| 2026-10-25 | T4 also owns `packages/daemon/src/domain/thread.ts`: add `Thread.toState(): ThreadState` and `static fromState(state: ThreadState): Thread` (rehydration for SqliteThreadRepository; fromState must not re-run invariants or record events; round-trip test required) | T2 implementer CONFLICT: Thread has a private constructor and no rehydration entry point; T4 is the first consumer |
| 2026-10-25 | Added a Naming convention (plain everyday names, no jargon) under Conventions; applies from T6 on; a naming pass runs in the lean review | User: "Make sure that your variable styles, class should be easy to read and easy keyword not the jargon ai slop keywords" |
| 2026-10-26 | Added T21: agent skill, README install guide, `tackboard` on the PATH (init copies the skill into the project) | User, after trying the tool on easy-immigration: first-time users need a skill and an install guide; chose all three |

## Open questions and assumptions
Open questions (only the user can answer)
- Q1. `@types/node` (dev, type checking only) is not on the allowed list, but `tsc` cannot check `node:sqlite`, `node:test`, `node:child_process` or `node:http` without it. This plan assumes it is allowed. If not, `npm run typecheck` can only cover the overlay and DTO code, and the Commands row must be reduced.

Assumptions
- A1. Undo of a restore: the restore appends a `system` message holding the safety checkpoint; its `Restore here` button rewinds the files back. Messages already discarded stay discarded (spec §3 "No redo" applies to the chat).
- A2. One daemon watches one working tree. Worktree scoping means the CLI sends its own branch on `claim-next`; restore and checkpoints always act on the daemon's project directory and are rejected with `wrong_branch` when the thread's branch is not checked out there.
- A3. The user may resolve a `waiting` thread; only the agent is blocked by the `waiting_on_user` rule (spec §14 "User can resolve or reopen").
- A4. The spec's "history archive" has no component in §18; it is the History footer view of the panel, listing discarded threads and threads of branches that no longer exist.
- A5. "What the agent saw" (spec §7) is the `ThreadDto` snapshot in the `claimed` event, returned by `GET /history` and printed by `tackboard history`; owner test is T3 `get history returns the claimed event with the thread snapshot`.
- A6. A thread is archived when its branch is not a local branch and is not `HEAD` or `no-git`.
- A7. Restore resets the real index to HEAD, so staged-but-uncommitted state is not preserved across a restore.
- A8. The page overlay is untrusted for identity: a foreign page can read the token but the Origin allow-list rejects it. The `Referer` of the bundle request is not checked.
- A9. The source attribute plugin is duck-typed (no `vite` dependency) and its transform is regex-based, so it is best effort and never run inside real Vite; the e2e fixture applies the same `addSourceAttrs` through esbuild.
- A10. Default mode on load is `view`; the chosen mode is not persisted across reloads; the panel position is not persisted.
- A11. The overlay uses system font stacks instead of the reference page's Google Fonts, to avoid loading anything from the network on the host page.

---
**Review checklist (orchestrator):** each task has exact files, steps, a reason, tests at every applicable level with a run command and expected output, and acceptance criteria. Every task has a row in Dependencies & conflicts. Tasks that write the same file are never in different parallel tracks. Tracks are real (not one serial chain). Out of scope is filled in. Nothing is speculative.
