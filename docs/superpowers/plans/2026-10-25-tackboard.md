# Tackboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Tackboard: click-to-comment on a dev site, agents claim and reply through a CLI, threads are kept per branch, and the project can be restored to an earlier message.

**Architecture:** A local TypeScript daemon (DDD four layers, command/query handlers, SQLite, git-ref checkpoints) is the single source of truth. A Shadow-DOM overlay served by the daemon and a `tackboard` CLI are thin HTTP clients. Everything is tested bottom-up (domain, repositories, HTTP, CLI) and then end to end in a real browser against a real daemon and a real git repo.

**Tech Stack:** Node 22 (runs `.ts` directly, type-stripping only), TypeScript, Hono, `node:sqlite`, `node:test`, esbuild (overlay bundle), Playwright (E2E only), React (E2E fixture only).

**Spec:** `docs/superpowers/specs/2026-10-25-llm-debugger-board-design.md` (UI reference: https://claude.ai/artifact/Uqxcd6FxXnW59ZgLarPnp4). `spike/` is throwaway reference code and is deleted in Task 8.

## Global Constraints

- TypeScript everywhere; Node 22; erasable syntax only (no enums, no constructor parameter properties, no namespaces) because Node strips types.
- Daemon is DDD: `domain/` has zero imports outside itself; `application/` imports domain only; `infrastructure/` imports domain interfaces; `interface/` imports application handlers only. One handler per command or query.
- Repositories are synchronous (`node:sqlite` is sync), so claiming is atomic without locks.
- Every user-facing name comes from `packages/shared/src/brand.ts` (`name`, `cli`, `dataDir`, `refPrefix`, `bundle`, `envPrefix`). No other file hardcodes "tackboard".
- Data lives in `<project>/.tackboard/tackboard.db`; `.tackboard/` is added to `.git/info/exclude`. Checkpoints are hidden git refs under `refs/tackboard/`.
- Daemon binds `127.0.0.1` only; checks `Host` and `Origin` against the registered dev origins; requires the token header on every route except `GET /tackboard.js` and `GET /health`.
- v1 has one agent. Updates are polled every 1 to 2 seconds. No screenshots. No drag-select. No `@` picker.
- Thread states: `pending`, `received`, `waiting`, `resolved`. A claim older than 30 minutes is stale and re-queueable. A user reply re-queues a thread to `pending`. A thread cannot be resolved while `waiting`.
- Comments are worked one at a time in creation order. Restore is blocked while any thread is claimed and not stale.
- Agent replies and comment text are rendered as text, never HTML.
- Restore rewinds the whole working tree to the chosen message's checkpoint after a safety snapshot; later messages are marked discarded and stay in the log.
- Snapshots include untracked, non-ignored files and exclude ignored files and `.tackboard/`; restore never deletes ignored files.

## Review Focus

Inputs and conditions the spec implies that no feature task would otherwise test. Each has a test in the task named in parentheses.

1. An agent reply or user comment containing `<img onerror=...>` or `</script>` renders as text and runs nothing (Task 10).
2. Two `next` calls at the same instant never return the same thread (Task 3, Task 12).
3. Restore with a dirty tree: modified, untracked and deleted files all return to the checkpoint state, and the safety snapshot can be restored back (Task 5, Task 12).
4. Branch names with slashes, detached HEAD, and a daemon started outside a git repo (Task 7, Task 8).
5. Oversized input: a 100 KB comment and an element whose outerHTML is 1 MB are truncated or rejected with a clear error, never crash the daemon (Task 7).

## File Structure

```
package.json                      npm workspaces: packages/*
tsconfig.base.json
packages/shared/src/{brand.ts,types.ts}
packages/daemon/src/domain/{value_objects.ts,thread.ts,errors.ts,repositories.ts}
packages/daemon/src/application/{commands/*.ts,queries/*.ts}
packages/daemon/src/infrastructure/{sqlite_thread_repository.ts,git_checkpoint_store.ts,clock.ts}
packages/daemon/src/interface/{http.ts,security.ts,main.ts}
packages/cli/src/{main.ts,client.ts,format.ts}
packages/overlay/src/{index.ts,api.ts,modes.ts,hover.ts,element_ref.ts,pins.ts,panel.ts,notifications.ts,source_map.ts}
packages/vite-plugin/src/index.ts  adds data-tb-src in dev
packages/*/test/*.test.ts         unit, contract, integration
e2e/{playwright.config.ts,fixtures/*,tests/*.spec.ts}
```

---

### Task 1: Workspace scaffold, brand, shared types

**Files:** Create root `package.json`, `tsconfig.base.json`, `packages/shared/src/brand.ts`, `packages/shared/src/types.ts`, `packages/shared/test/brand.test.ts`; run `git init`.

**Interfaces:**
- Produces: `brand` (fields above); types `ThreadStatus`, `Author = "user" | string`, `ElementRef { selector: string; tag: string; text: string; html: string; rect: {x:number;y:number;w:number;h:number}; component?: string[]; source?: string; confidence: "source"|"component"|"text" }`, `MessageDto { id: string; author: Author; text: string; at: number; discarded: boolean; checkpointId?: string }`, `ThreadDto { id: string; n: number; branch: string; commit: string; url: string; element: ElementRef; status: ThreadStatus; agent?: string; unread: boolean; messages: MessageDto[] }`.

- [ ] **Step 1: Failing test** `brand.test.ts`: `assert.equal(brand.cli, "tackboard")`; `assert.equal(brand.dataDir, ".tackboard")`; and a guard test that greps `packages/*/src` (excluding `brand.ts`) and asserts no match for `/tackboard/i`.
- [ ] **Step 2:** Run `node --test packages/shared/test` → FAIL (module missing).
- [ ] **Step 3:** Create the files above; `npm test` runs `node --test "packages/*/test/*.test.ts"`.
- [ ] **Step 4:** Run `npm test` → PASS.
- [ ] **Step 5:** Commit `chore: workspace scaffold, brand constant, shared types`.

### Task 2: Domain: value objects and the Thread aggregate

**Files:** Create `packages/daemon/src/domain/{value_objects.ts,errors.ts,thread.ts}`; Test `packages/daemon/test/thread.test.ts`.

**Interfaces:**
- Consumes: shared types.
- Produces: `class DomainError extends Error { code: string }`; value objects `Branch.of(name: string): Branch`, `CommitSha.of(s: string): CommitSha`, `AgentName.of(s: string): AgentName` (non-empty, `[a-z0-9._-]`, max 40); `class Thread` with `static open(a: {id:string; n:number; branch:Branch; commit:CommitSha; url:string; element:ElementRef; text:string; now:number}): Thread`, `claim(agent: AgentName, now: number): void`, `reply(author: Author, text: string, now: number, opts?: {ask?: boolean}): void`, `resolve(): void`, `release(): void`, `reopen(): void`, `isStaleClaim(now: number): boolean`, `discardAfter(messageId: string): string[]` (returns ids of threads' messages discarded), `attachCheckpoint(messageId: string, checkpointId: string): void`; getters `status`, `messages`, `agent`.

- [ ] **Step 1: Failing tests** (each name with assertions):
  - `open creates pending thread with one user message`
  - `claim moves pending to received and records agent`; `claim on a non-pending thread throws DomainError "not_pending"`
  - `agent reply with ask moves to waiting`; `user reply moves any non-resolved thread to pending and clears agent`
  - `resolve while waiting throws "waiting_on_user"`; `resolve after reply succeeds`; `reopen on resolved returns pending`
  - `stale claim: isStaleClaim(claimedAt + 30*60_000 + 1) is true, at exactly +30*60_000 is false`
  - `discardAfter marks later messages discarded and leaves earlier ones`
  - `Branch.of accepts "feature/pricing" and "HEAD"; AgentName.of rejects ""`
- [ ] **Step 2:** `node --test packages/daemon/test/thread.test.ts` → FAIL.
- [ ] **Step 3:** Implement per signatures. Message ids are `m<n>` per thread; the state transitions live on `Thread`, not in handlers.
- [ ] **Step 4:** Tests → PASS.
- [ ] **Step 5:** Commit `feat(domain): Thread aggregate and value objects`.

### Task 3: Application layer with an in-memory repository

**Files:** Create `domain/repositories.ts`, `application/commands/{post_comment,claim_next_thread,reply_to_thread,resolve_thread,release_thread}.ts`, `application/queries/{get_thread,list_threads}.ts`, `packages/daemon/test/in_memory_repo.ts`; Test `packages/daemon/test/handlers.test.ts`.

**Interfaces:**
- Produces in `repositories.ts`: `interface ThreadRepository { nextId(): string; nextNumber(branch: Branch): number; get(id: string): Thread | null; save(t: Thread): void; claimNext(branch: Branch, agent: AgentName, now: number): Thread | null; listByBranch(branch: Branch): Thread[]; listAll(): Thread[]; }` and `interface Clock { now(): number }`, `interface GitInfo { branch(): Branch; commit(): CommitSha }`.
- Handlers: each is a class with `handle(cmd)`; `PostCommentHandler.handle({element, url, text}) : ThreadDto`; `ClaimNextThreadHandler.handle({agent}) : ThreadDto | null` (stale claims on the branch are released first); `ReplyToThreadHandler.handle({id, author, text, ask?}) : ThreadDto`; `ResolveThreadHandler.handle({id})`; `ReleaseThreadHandler.handle({id})`; `ListThreadsHandler.handle({branch?, state?}) : ThreadDto[]`.
- `claimNext` must apply `Thread.claim` and persist in one synchronous call (atomic).

- [ ] **Step 1: Failing tests:** `post then claim returns the thread and a second claim returns null`; `claims oldest first across three posts`; `stale claim is re-queued before claiming`; `reply with ask then user reply returns thread to pending and next claim returns it again`; `list filters by branch`; `resolve while waiting rejects with waiting_on_user`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement handlers and the in-memory repo (test helper only). Handlers contain no rules; they call `Thread` methods.
- [ ] **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(application): comment, claim, reply, resolve handlers`.

### Task 4: SQLite repository (contract tests)

**Files:** Create `infrastructure/sqlite_thread_repository.ts`, `infrastructure/clock.ts`; Test `packages/daemon/test/thread_repository.contract.ts` (exported function `runContract(makeRepo)`), `sqlite_thread_repository.test.ts`.

**Interfaces:** Produces `class SqliteThreadRepository implements ThreadRepository` with constructor `(dbPath: string)`; tables `threads`, `messages` created on open; `SystemClock implements Clock`.

- [ ] **Step 1:** Contract suite run against both the in-memory repo and SQLite: `save then get round-trips every field including messages and discard flags`; `claimNext is atomic: two calls in a row return different threads or null`; `data survives closing and reopening the db file`; `listByBranch isolates branches`; `nextNumber is per branch and monotonic`.
- [ ] **Step 2:** Run → FAIL for SQLite.
- [ ] **Step 3:** Implement with `node:sqlite` `DatabaseSync`; `claimNext` runs select plus update inside `BEGIN IMMEDIATE`.
- [ ] **Step 4:** PASS for both implementations.
- [ ] **Step 5:** Commit `feat(infrastructure): SQLite thread repository`.

### Task 5: Git checkpoint store

**Files:** Create `domain/checkpoint_store.ts` (interface), `infrastructure/git_checkpoint_store.ts`; Test `packages/daemon/test/git_checkpoint_store.test.ts` using temp git repos.

**Interfaces:** `interface CheckpointStore { snapshot(label: string): string /*checkpoint id = commit sha*/; restore(id: string): void; changedFiles(fromId: string, toId: string): string[]; hasChangedSince(id: string): boolean; }`; `class GitCheckpointStore implements CheckpointStore` with constructor `(projectDir: string)`; refs `refs/tackboard/<seq>`. Snapshot uses a temporary index (`GIT_INDEX_FILE`) plus `git add -A` equivalents, `write-tree`, `commit-tree`, `update-ref`; never touches HEAD, the real index or the user's stash.

- [ ] **Step 1: Failing tests** (temp repo with `.gitignore` containing `ignored.txt`):
  - `snapshot does not change HEAD, the index, or git status output`
  - `restore returns modified, untracked and deleted files to the snapshot state`
  - `restore leaves ignored.txt and .tackboard/ untouched`
  - `restore never deletes a file that was not in the snapshot only if it is ignored; untracked non-ignored files added later are removed`
  - `hasChangedSince is false right after snapshot and true after editing a file`
  - `changedFiles lists paths between two snapshots`
  - `works on a branch name with a slash and on detached HEAD`
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement with `child_process.execFileSync("git", args, {cwd, env})`; no shell strings.
- [ ] **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(infrastructure): git checkpoint store`.

### Task 6: Checkpoint triggers, restore, and agent notices

**Files:** Create `application/commands/restore_to_message.ts`, `application/commands/ack_notices.ts`, `domain/notice.ts`; Modify the claim, reply and resolve handlers; Test `packages/daemon/test/restore.test.ts`.

**Interfaces:**
- Consumes: `CheckpointStore`, `ThreadRepository`.
- Produces: `RestoreToMessageHandler.handle({threadId, messageId}): {restoredTo: string; discardedMessageIds: string[]; changedFiles: string[]; safetyCheckpointId: string}` (throws `DomainError "restore_blocked"` while any thread is claimed and not stale); `type Notice = {id:string; at:number; restoredToMessage:string; files:string[]; discardedThreads:string[]}`; `NoticeRepository { add(n: Notice): void; pendingFor(agent: string): Notice[]; ack(agent: string): void }` (SQLite table `notices`; add to the repository contract); `AckNoticesHandler.handle({agent})`. Checkpoint rules: one snapshot at claim; one at each reply or resolve only when `hasChangedSince(lastCheckpoint)`; stored on the message via `attachCheckpoint`.

- [ ] **Step 1: Failing tests:** `claim creates a checkpoint on the claim message`; `reply with no file change creates no checkpoint`; `reply after a file edit creates one`; `restore rewinds files, takes a safety checkpoint first, marks later messages discarded`; `restore throws restore_blocked while a thread is claimed, succeeds when the claim is stale`; `restore adds a notice that pendingFor(agent) returns until ack`; `discarded threads are listed in the notice`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement. Notice generation lives in the handler; the "discarded thread" decision is `Thread.discardAfter`.
- [ ] **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat: checkpoints, restore, agent notices`.

### Task 7: HTTP interface, security, and daemon composition

**Files:** Create `interface/security.ts`, `interface/http.ts`, `interface/main.ts`, `infrastructure/git_info.ts`; Test `packages/daemon/test/http.test.ts`, `security.test.ts`.

**Interfaces:**
- Produces: `createDaemon(opts: {projectDir: string; port: number; allowedOrigins: string[]; token: string; clock?: Clock}): {listen(): Promise<number>; close(): Promise<void>}`. Routes: `GET /health`, `GET /tackboard.js` (serves the built overlay with `{token, origin}` injected), `POST /threads`, `GET /threads?branch=&state=`, `POST /threads/claim-next {agent}`, `POST /threads/:id/messages {author,text,ask?}`, `POST /threads/:id/resolve`, `POST /threads/:id/release`, `POST /restore {threadId,messageId}`, `POST /agents/:name/ack`, `GET /notices?agent=`. Errors are `{error: code, message}` with 4xx; the daemon never throws to the socket.
- Security: reject when `Host` is not `127.0.0.1:<port>` or `localhost:<port>` (403); when `Origin` is present and not in `allowedOrigins` (403); when the token header `x-tackboard-token` is missing or wrong (401); CORS only for allowed origins. Limits: body max 2 MB; comment text max 100 KB; `html` field truncated to 4 KB.

- [ ] **Step 1: Failing tests** against a real listening daemon in a temp git repo: `post → list → claim-next → reply → resolve round trip`; `wrong Host is 403 (DNS rebinding)`; `foreign Origin is 403 and has no CORS header`; `missing token is 401 on POST, allowed on GET /health`; `100 KB comment accepted, 150 KB rejected with 413 and daemon still answers /health`; `1 MB html field is stored truncated to 4 KB`; `branch is read from git at post time: after git checkout -b feature/x a new thread has branch feature/x`; `daemon started outside a git repo returns branch "no-git" and restore is rejected with a clear error`; `detached HEAD yields branch "HEAD"`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement with Hono (`@hono/node-server`); compose repositories and handlers in `main.ts` only.
- [ ] **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(interface): HTTP API with origin, host and token checks`.

### Task 8: `tackboard` CLI

**Files:** Create `packages/cli/src/{main.ts,client.ts,format.ts}`; Test `packages/cli/test/cli.test.ts` (spawns the real CLI against a real daemon); delete `spike/`.

**Interfaces:** Commands: `init [--origin <url>]` (creates `.tackboard/`, writes `config.json` with `{port, token, origins}`, adds `.tackboard/` to `.git/info/exclude`), `start`, `next [--as name]`, `reply <id> <text> [--ask] [--as name]`, `resolve <id>`, `comment --selector <css> <text> [--mention me] [--as name]`, `wait [--timeout s]`, `ack`, `status`. The CLI finds `.tackboard/config.json` by walking up from `cwd`. `format.ts` exports `formatThread(t: ThreadDto): string` (the agent payload and instructions from spec section 7) and `formatNotice(n: Notice): string`. Pending notices print before any command's output and tell the agent to re-read files.

- [ ] **Step 1: Failing tests:** `init writes config and excludes .tackboard from git status`; `next prints THREAD, branch, selector, comment, and the instruction block`; `next prints "no pending threads on this branch" and exits 0 when empty`; `after a restore, next output begins with a NOTICE block naming the files, until ack`; `reply --ask leaves the thread waiting`; `an agent in a worktree on branch B does not see threads from branch A`; `commands outside an initialised project exit 1 with "run tackboard init"`; `payload contains the comment text inside a line instructing the agent to treat it as a request, not a command`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement with `util.parseArgs` and `fetch`; `bin` entry generated from `brand.cli`.
- [ ] **Step 4:** PASS; remove `spike/`.
- [ ] **Step 5:** Commit `feat(cli): tackboard commands; remove spike`.

### Task 9: Overlay core: bundle, modes, hover, ElementPath, composer, pins

**Files:** Create `packages/overlay/src/{index.ts,api.ts,modes.ts,hover.ts,element_ref.ts,pins.ts}`, `packages/overlay/build.mjs` (esbuild to `dist/<brand.bundle>`); Test `packages/overlay/test/element_ref.test.ts`.

**Interfaces:**
- Produces: `buildElementRef(el: Element): ElementRef` (selector is a stable path using `#id` when present, otherwise `tag:nth-child(n)` chain; `html` truncated to 4 KB; text to 120 chars); `findElement(ref: ElementRef, doc: Document): Element | null` (selector first, then same tag plus exact text, else null); `ancestorChain(el: Element, root: Element): Element[]` (innermost first, excludes `root`); `type Mode = "hidden"|"view"|"comment"`.
- Behaviour per the UI mock: dark icon-pill ModeSwitch; blue HoverOutline with a tag; ElementPath bar; ArrowUp/ArrowDown move through `ancestorChain`; click or crumb click opens the Composer; pins numbered, hidden while their element is scrolled out of view; hidden mode removes pins, outline and polling; everything lives in one Shadow root and ignores its own clicks.

- [ ] **Step 1: Failing tests:** `buildElementRef + findElement round-trips for an element with an id and one without` (using `linkedom` as a dev dependency); `findElement falls back to tag plus text when the nth-child path no longer matches`; `findElement returns null when nothing matches`; `ancestorChain excludes the root and starts at the innermost`; `html longer than 4 KB is truncated`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement pure functions first, then the DOM modules. Visual behaviour is verified in Task 12.
- [ ] **Step 4:** PASS; `node packages/overlay/build.mjs` produces the bundle.
- [ ] **Step 5:** Commit `feat(overlay): modes, hover outline, element path, pins`.

### Task 10: Overlay panel: threads, replies, tabs, scroll links, notifications, restore UI

**Files:** Create `packages/overlay/src/{panel.ts,notifications.ts}`; Test `packages/overlay/test/panel_logic.test.ts`.

**Interfaces:** `visibleThreads(threads: ThreadDto[], tab: "open"|"resolved"): ThreadDto[]`; `badgeCount(threads: ThreadDto[]): number` (waiting or unread); `notificationState(): "granted"|"default"|"denied"|"unsupported"`; `escapeText` is not needed: all text is set with `textContent`. Behaviour per the mock: floating draggable CommentsPanel closed by default, opened by the chat icon, a started comment, a pin or a thread; Open/Resolved tabs; collapsed ThreadItems; one open at a time; reply box; click thread scrolls page and pulses pin; click pin opens thread; RestorePoint rows and RestoreConfirm (disabled with the reason when restore is blocked); PermissionBanner states; Detached list for threads whose `findElement` is null; unread cleared when opened; polling every 1.5 s, paused in hidden mode.

- [ ] **Step 1: Failing tests:** `visibleThreads splits open and resolved`; `badgeCount counts waiting and unread threads once each`; `notificationState maps Notification.permission and returns "unsupported" when absent`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement. Every string from the API is inserted with `textContent` or `setAttribute`, never `innerHTML`.
- [ ] **Step 4:** PASS. Add the XSS and scroll tests in Task 12 (they need a browser).
- [ ] **Step 5:** Commit `feat(overlay): comments panel, replies, notifications, restore UI`.

### Task 11: React source mapping

**Files:** Create `packages/overlay/src/source_map.ts`, `packages/vite-plugin/src/index.ts`; Test `packages/overlay/test/source_map.test.ts`, `packages/vite-plugin/test/plugin.test.ts`.

**Interfaces:** `readSourceInfo(el: Element): {component?: string[]; source?: string; confidence: "source"|"component"|"text"}` (reads `data-tb-src` from the nearest ancestor that has it; component names from the React fiber key `__reactFiber$*` walking `return` and collecting named function components; neither found → `"text"`); `tackboardVitePlugin(): Plugin` which in `serve` mode adds `data-tb-src="<relative path>:<line>"` to host JSX elements via a transform, and does nothing in `build`. The agent payload prints `component:`, `source:` and `confidence:` lines (extend `formatThread`).

- [ ] **Step 1: Failing tests:** `source from data-tb-src wins and reports confidence "source"`; `fiber names produce ["PricingPage","PlanCard"] with confidence "component"`; `plain DOM yields confidence "text"`; `plugin adds data-tb-src in serve mode and leaves build output unchanged`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement. Keep each layer independent so any can be absent.
- [ ] **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat: component and source mapping for React`.

### Task 12: End-to-end suite (Playwright)

**Files:** Create `e2e/playwright.config.ts`, `e2e/fixtures/{harness.ts,site/index.html,react-site/*}`, `e2e/tests/*.spec.ts`.

**Harness** (`harness.ts`): per test, create a temp git repo with a committed `index.html` containing nested divs, buttons, a heading far below the fold and a script tag for the daemon bundle; run `tackboard init --origin http://127.0.0.1:<sitePort>`; start the daemon and a static server for the site; expose `agent(args: string[]): {stdout:string; code:number}` which runs the real CLI with `cwd` set to the repo, `git(args)`, and `page`. Tests never talk to the daemon directly except in the security spec.

**Test plan, one spec file per row; every row is a test that must pass:**

| Spec | Flow and assertions |
|---|---|
| `comment_loop` | Turn on comment mode, hover `#cta` (blue outline present), click, type, send. Chip shows `pending`. `agent(["next"])` prints the comment and selector; chip becomes `received` within 3 s. `agent(["reply", id, "which blue?", "--ask"])`; chip shows `waiting on you` and the reply text appears. Type a user reply; chip returns to `pending`; `next` returns the same thread. `resolve`; thread moves to the Resolved tab. |
| `modes` | `hidden`: no pins, no outline, no polling requests (count `GET /threads` over 4 s = 0). `view`: pins visible, clicking `#cta` triggers the page's own handler. `comment`: clicks do not trigger the page handler. |
| `nested_hover` | On a 4-level nested div, hover the innermost: outline matches its rect. ArrowUp three times: outline matches each ancestor in turn and the crumb bar highlights it. Click a middle crumb: composer target shows that ancestor. The page root is never selectable. |
| `branch_scoping` | Comment on `main`; `git checkout -b feature/x`; `next` prints "no pending threads"; page shows an empty Open tab; comment on `feature/x`; `git checkout main`; `next` returns only the `main` thread; delete `feature/x` after merge: its thread appears under archive, not as a pin. |
| `restore` | Claim, edit a tracked file, add an untracked file and delete another through the agent shell, reply. Resolve. In the panel click Restore on the first message and confirm: files equal the original; later messages show as discarded in the history; next `agent(["next"])` output starts with NOTICE listing the files; after `ack` the notice is gone. Restore while a thread is claimed shows the disabled button with its reason. A second restore to the safety snapshot brings the edits back. |
| `scroll_links` | Click a thread whose element is below the fold: `scrollTop` changes, the element has the flash outline, the pin pulses. Scroll away: pin is absent. Click a pin: its thread opens. |
| `panel_ui` | Panel closed on load; chat icon opens it; a started comment opens it; the badge counts waiting and unread; header drag moves it and keeps it inside the viewport; ✕ closes it. |
| `notifications` | With `permissions: ["notifications"]` granted: an agent reply fires a notification. With denied: the blocked banner is shown with the settings hint. Default state: Allow button requests permission. |
| `xss` | Agent replies `<img src=x onerror="window.__pwn=1">` and `</script><script>window.__pwn=1</script>`; after render `window.__pwn` is undefined and the text appears literally. Same for a user comment. |
| `security` | With `fetch` from `page.evaluate` on a foreign origin page: request to the daemon fails (403, no CORS header). Forged `Host` header via a raw socket gets 403. Missing token gets 401. |
| `detached` | Remove the commented element from the DOM and reload: the thread appears in the Detached list, answerable, with no pin. |
| `persistence` | Restart the daemon: threads, messages, discarded flags and pending notices are unchanged. |
| `claim_race` | Post 3 comments; run 10 `next` processes at once; the union of printed thread ids has exactly 3 distinct ids and no id appears twice. |
| `stale_claim` | With the daemon clock offset by 31 minutes (`TACKBOARD_CLOCK_OFFSET_MIN` honoured only when `NODE_ENV=test`): a claimed thread is claimable again; restore is allowed. |
| `react_mapping` | In the React fixture with the Vite plugin: payload shows `source: src/PlanCard.tsx:<line>` and `confidence: source`. Without the plugin: `component: PricingPage > PlanCard` and `confidence: component`. Plain HTML site: `confidence: text`. |
| `oversize` | A 100 KB comment is accepted; a 150 KB comment shows an inline error and the daemon stays healthy; an element with 1 MB of HTML stores a 4 KB snippet. |

- [ ] **Step 1:** Write the harness and `comment_loop`; run `npx playwright test comment_loop` → FAIL (nothing wired).
- [ ] **Step 2:** Make it pass by fixing integration gaps found (not by weakening assertions).
- [ ] **Step 3:** Add the remaining specs one at a time, each run to FAIL then PASS.
- [ ] **Step 4:** Run the whole suite three times in a row; all green, no retries enabled in config.
- [ ] **Step 5:** Commit `test(e2e): full suite`.

### Task 13: CI script and README

**Files:** Create `package.json` scripts `test`, `test:e2e`, `build`, `README.md` (setup: `npm i`, `tackboard init`, script tag, `tackboard next`).

- [ ] **Step 1:** `npm run build && npm test && npm run test:e2e` from a clean clone → all pass.
- [ ] **Step 2:** Commit `docs: README and scripts`.

---

## Test pyramid summary

| Level | Tool | What it proves | Tasks |
|---|---|---|---|
| Unit | `node:test` | Thread rules, state machine, stale claims, value objects, element matching, panel logic | 1, 2, 9, 10, 11 |
| Contract | `node:test` | In-memory and SQLite repos behave identically; git checkpoints restore exactly | 4, 5 |
| Integration | `node:test` + real daemon/CLI | Handlers, HTTP security, CLI output, branch scoping, notices | 3, 6, 7, 8 |
| End to end | Playwright + real git repo + real CLI | The whole user and agent loop, UI behaviour, restore, security, persistence | 12 |

## Self-review notes

- Spec coverage: modes, hover and nested path, composer, pins, panel, tabs, scroll links, notifications, statuses, claim and stale rules, agent payload, restore and notices, React mapping, security, persistence, branch scoping, archive of deleted branches (E2E `branch_scoping`), naming constant (Task 1 guard test), history log (Tasks 2 and 6). Agent-started threads: `tackboard comment` in Task 8; its E2E assertion is added to `comment_loop` (agent comment appears with the agent's name and mentions the user).
- Deferred by the spec: `@` picker, drag-select, screenshots, extension, push updates.
- Interfaces: `Thread`, `ThreadRepository`, `CheckpointStore`, `Notice` names are used identically in Tasks 2 to 8.
