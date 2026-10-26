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
| T15 | D | T12, T13 | `e2e/fixtures/states.ts`, `e2e/tests/style_rows.ts`, `e2e/tests/styles.spec.ts`, `e2e/tests/responsive.spec.ts` | provides `Style rows`; consumes `E2E harness`; consumes `Overlay panel` | — |
| T16 | D | T13, T14, T15 | `README.md` | consumes `E2E harness` | — |

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
- **Files:** `e2e/fixtures/states.ts` (edit: add the state helpers the rows name), `e2e/tests/style_rows.ts` (new), `e2e/tests/styles.spec.ts` (new), `e2e/tests/responsive.spec.ts` (new)
- **Steps:**
  1. `style_rows.ts` exports `rows: StyleRow[]` where `StyleRow = { id; state: string (a `states.ts` helper name); selector: string (CSS inside the Shadow root); width: number; scheme: "light" | "dark"; reducedMotion?: boolean; prop: string; expected: string | { cssVar: string }; breakCss: string }`. Colours given as `{ cssVar }` are read at run time from the computed value of that variable on the host element (`:host` tokens), normalised to `rgb(...)` through a probe element; literal expectations are written as `rgb(...)`.
  2. `styles.spec.ts` generates, per row, two tests: `<id> holds` (reach the state, read `getComputedStyle(el)[prop]`, assert equals expected) and `<id> fails when broken` (inject `breakCss` with `!important` into a `<style>` appended to the Shadow root, assert the same read no longer equals expected, then remove it and assert it holds again).
  3. `responsive.spec.ts` runs a measurement helper at 320, 390 and 1280 px (and 800 px height) through these toggles in order: mode (hidden, view, comment), panel open and closed, Open and Resolved tabs, thread expanded (with a 200-character unbroken string in a message), composer open, RestoreConfirm shown, permission banner (default and denied), History view, drag to the top-left, drag to the bottom-right, resize 1280 to 320, colour scheme (light and dark emulation). After each step it asserts: panel rect and ModeSwitch rect inside the viewport; `document.documentElement.scrollWidth <= innerWidth`; panel `scrollWidth <= clientWidth`; the thread list scrolls vertically inside the panel (`max-height` respected); no ModeSwitch button is covered by the panel. Screenshots are saved per width.
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

## Status
| Task | Status | Attempts | Model | Last verdict |
|---|---|---|---|---|
| T1 | verified | 1 | sonnet | PASS #1 |
| T2 | verified | 1 | sonnet | PASS #1 |
| T3 | verified | 2 | sonnet | PASS #2 |
| T4 | verified | 2 | sonnet | PASS #2 |
| T5 | verified | 2 | sonnet | PASS #2 |
| T6 | in-progress | 1 | sonnet | — |
| T7 | pending | 0 | sonnet | — |
| T8 | verified | 1 | sonnet | PASS #1 |
| T9 | verified | 1 | sonnet | PASS #1 |
| T10 | pending | 0 | sonnet | — |
| T11 | verified | 1 | sonnet | PASS #1 |
| T12 | pending | 0 | sonnet | — |
| T13 | pending | 0 | sonnet | — |
| T14 | pending | 0 | sonnet | — |
| T15 | pending | 0 | sonnet | — |
| T16 | pending | 0 | sonnet | — |

Statuses: `pending` · `in-progress` · `verified` · `flagged` · `paused` (waiting on a conflict fix). This table is written by `orch.py`; never edit it by hand.

## Revision log
| Date | Change | Why (user pushback / verifier finding) |
|---|---|---|
| 2026-10-25 | Initial plan converted from the design spec and the source plan | First draft; deviations from the source plan are listed in Conventions |
| 2026-10-25 | T4 also owns `packages/daemon/src/domain/thread.ts`: add `Thread.toState(): ThreadState` and `static fromState(state: ThreadState): Thread` (rehydration for SqliteThreadRepository; fromState must not re-run invariants or record events; round-trip test required) | T2 implementer CONFLICT: Thread has a private constructor and no rehydration entry point; T4 is the first consumer |
| 2026-10-25 | Added a Naming convention (plain everyday names, no jargon) under Conventions; applies from T6 on; a naming pass runs in the lean review | User: "Make sure that your variable styles, class should be easy to read and easy keyword not the jargon ai slop keywords" |

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
