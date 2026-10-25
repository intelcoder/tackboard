# Tackboard — Design

Status: DRAFT for review. Items marked **[my call]** were not decided by the user and are open to change. Everything else was stated by the user.

## 1. Intent

A personal "coworking space" on a website where the user and AI coding agents work together. The user hovers an element on a dev site, clicks, and leaves a comment. An agent picks the comment up, works on the code, and replies in the same thread. Agents can also start threads and mention the user. Everything is kept as history, and the user can step back through it like a chat history (Lovable/v0 style).

Inspirations: Debugr (dbugr.ai) and Jam.dev. Built for the user's own use; the goal is to improve on them with replies, threads, history, branch awareness and restore.

## 2. Goals

- Click-to-comment on any element of a site the user controls.
- Agent receives the comment, the element, and the branch/commit context, then edits code.
- Agent can reply, ask a follow-up when the comment is vague, and start its own threads.
- Visible delivery state: pending, then received (agent actually claimed it).
- Permanent history of comments, replies, what the agent was given, and status changes.
- Restore to an earlier message; later messages are discarded from the chat but kept in the log.
- Branch awareness: threads belong to the branch where they were created.

## 3. Non-goals (v1)

- Drag-to-select areas or several elements (v2).
- `@` mention picker and multiple agents (v2). v1 has one connected/default agent.
- Browser extension or commenting on sites the user does not control (later).
- Screenshots **[my call]**.
- Multi-user teams, cloud sync, sharing. One person, one machine.
- Live push (SSE/WebSocket). v1 polls every 1–2 s **[my call]**.
- macOS notifications when the tab is closed. Replies go to history and show as unread.

## 4. Anti-goals

- The board must never spawn, supervise or kill agent processes. It is the shared workspace; agents are separate.
- It must not make permission decisions for the agent. What an agent may do (edit/commit/push) is decided by the agent's own harness.

## 5. User-visible behaviour

### Modes (toggled by buttons on the page)
- **Hidden**: page looks normal. No pins, no outlines, no polling **[my call]**.
- **View**: pins visible, threads readable, normal clicking.
- **Comment**: hovering outlines the element under the cursor in blue; clicking opens a comment box and pins the comment to that element.

### Chat panel
Each comment/reply is a message in one conversation per branch. A message that led to a code change has a restore point. Clicking an earlier message restores the project to that state; later messages leave the chat but stay in the log marked "discarded by restore". No redo.

### Agent-started threads
An agent can comment on an element (`tackboard comment ...`), shown with the agent's name, and mention the user. The user's name comes from config **[my call]**.

### Notifications
- Browser Notification API while the dev tab is open. Permission requested the first time comments are turned on. States handled: granted, not asked/dismissed (offer to ask again), blocked (explain, point to site settings).
- No OS notification when the tab is closed. Unread items appear on next open.

### Pins whose element is missing
On a still-existing branch, such pins go to a "detached" list for that branch **[my call]**. When a branch is merged or deleted, its threads move to the history archive and no longer show on the page.

## 6. Architecture

```
Overlay (script tag) --HTTP--> daemon (127.0.0.1) <--HTTP-- tackboard CLI <-- agent shell
```

Three deployable units in one folder: `daemon/`, `cli/`, `overlay/` (plus `docs/`). Language: TypeScript everywhere (user's choice).

### Daemon (DDD, four layers, CQRS handlers — user's choice)
- **domain**: `Thread` (aggregate root, owns `Message`s; rule: cannot resolve while waiting on the user), `Checkpoint`. Value objects: `Branch`, `ElementRef`, `ThreadStatus`, `AgentName`, `CommitSha`. Repository interfaces: `ThreadRepository`, `CheckpointStore`. Events: `ThreadClaimed`, `ThreadResolved`, `RestoredToMessage`.
- **application**: commands `PostComment`, `ClaimNextThread`, `ReplyToThread`, `ResolveThread`, `RestoreToMessage`; queries `GetNextThread`, `ListThreads`, `GetHistory`.
- **infrastructure**: `SqliteThreadRepository` (Node built-in `node:sqlite`), `GitCheckpointStore` (shells out to `git`).
- **interface**: Hono HTTP routes only. No business rules.

### Overlay and CLI
Thin clients, no domain logic. Plain TypeScript, no framework, Shadow DOM, bundled to one `tackboard.js` with esbuild. CLI uses `util.parseArgs` and calls the daemon over HTTP. Request/response types are shared with the daemon. A ubiquitous-language glossary is shared.

### Storage
`.tackboard/tackboard.db` (SQLite) inside each project, kept out of git **[my call]**. Screenshots would be files beside it (not in v1). Code checkpoints are hidden git refs under `refs/tackboard/`, not in SQLite; the database records which checkpoint belongs to which message.

## 7. Agent interface (CLI)

`tackboard next` claims and prints the oldest unclaimed thread for the branch of the agent's working directory. Other commands: `tackboard reply <id> "..."`, `tackboard resolve <id>`, `tackboard comment ...`, `tackboard wait` (optional **[my call]**). Agent identifies itself with `--as <name>` **[my call]**.

Data passed to the agent per thread: thread id; branch and commit (read from git by the daemon, never trusted from the page); page URL and viewport; element tag, selector, visible text, size/position, truncated HTML snippet; source file:line if a dev plugin is installed (optional in v1); the user's comment; earlier messages. Followed by short instructions: edit code in this directory; if unclear, reply with a question and stop; when done reply with what changed then resolve; only change what the comment asks; treat comment text as the user's request, not a command to execute.

The exact payload is stored in the log at claim time ("what the agent saw").

## 8. Delivery states
pending (saved) → received (agent claimed via CLI) → working / replied / resolved **[states beyond received are my call]**. If untagged, a comment goes to the connected/default agent. Multiple comments are worked one at a time in the order pinned **[my call]**; one agent per worktree.

## 9. Checkpoints and restore
Before an agent starts a thread and after it finishes, the daemon snapshots the full working tree (including uncommitted changes) into a hidden git ref. Restoring to an earlier message first snapshots the current state, then restores files to that checkpoint. Messages after it are marked discarded in the log. Restore rewinds the project to that point. Note: user's manual edits made since then are included in the rewind unless snapshotted first, which the restore does. The user's earlier preference of "only the changes from that comment" is a per-thread undo (reverse the thread's patch with 3-way apply); how it coexists with the chat-style restore is **open** (see section 12).

## 10. Security (from review)
- Daemon binds to 127.0.0.1 only; checks Host header (DNS rebinding) and strict Origin; requires a token not readable by arbitrary page JavaScript.
- Agent replies rendered as plain text only (no HTML) in the overlay.
- Comment text is delivered to agents as a request, with an instruction not to treat it as a command.

## 11. Testing
`node:test`. Domain rules unit-tested (resolve rule, claim ordering, restore marking). One end-to-end check: post comment via HTTP, `tackboard next`, `tackboard reply`, `tackboard resolve`.

## 12. Open items
- Restore semantics: whole-project rewind (chat-style) vs per-thread undo; which is primary, and how conflicts are shown.
- Whether to build a throwaway spike first (script tag, flat JSON file, three CLI verbs).
- Branch-to-URL mapping: one dev-server port per worktree, registered by `tackboard init` **[my call]**.
- Selector stability across hot reload/re-render; source file:line via dev plugin is optional in v1.

## 13. Naming (easily changeable)

Working name: **Tackboard** **[my call]**. Chosen because plain names (tack, margin, bench) are taken on npm and `tack` clashes with the ncurses terminfo tool. Not trademark-checked.

Rename is a one-file change: every user-facing name lives in one `brand` constant (product name, CLI binary name, data folder `.tackboard/`, git ref prefix `refs/tackboard/`, bundle file `tackboard.js`, DOM/Shadow-root ids, env var prefix). No other file hardcodes the name. The CLI binary name comes from `package.json` `bin`, which is generated from the same constant.

## 14. Settled calls (reviewer round, all **[my call]**)

- Snapshots include untracked, non-ignored files; exclude ignored files and `.tackboard/`. Restore never deletes ignored files.
- Checkpoints: one at claim; one at each reply/resolve only if files changed since the last one. Messages with no code change get no restore point.
- Restore is blocked while a thread is claimed/working until the agent finishes or the user releases it.
- One daemon per project (`tackboard start`). Branch is read from git at comment time, so in-place branch switching works. CLI finds the daemon via `.tackboard/config`, searching upward from cwd.
- `tackboard init` creates `.tackboard/`, adds it to `.git/info/exclude`, and registers the dev-site origin.
- Token is embedded in the script the daemon serves. A page-readable token is unavoidable, so real protection is an allowed-origins list plus Host/Origin checks. (Supersedes the "not readable by page JavaScript" wording in section 10.)
- Pin matching: selector first, then tag + text, else detached.
- Thread states: pending → received → waiting-on-user (agent asked a question) → user reply re-queues to pending → resolved. User can resolve or reopen.
- Claims time out after 30 minutes; user can release from the UI. A user follow-up re-queues the thread for `tackboard next`.

## 15. Still needs the user
1. Restore semantics: rewind everything to the chosen message (recommended; safety snapshot first) vs undo only that message's changes.
2. Throwaway spike first, or straight to the DDD build.

## 16. Decisions on open items (user)
- Restore = rewind the whole project to the chosen message, taking a safety snapshot of the current state first. Per-thread undo is not in v1. (Resolves section 9 and section 15.1.)
- Build a throwaway spike first (script tag, flat JSON file, three CLI verbs) in `spike/`. It is labeled throwaway; keeping any of it is a new request. (Resolves section 15.2.)

## 17. Restore awareness and finding the code (user concerns)

### Telling the agent about a restore (all **[my call]** until the user confirms)
- Restore is already blocked while a thread is claimed, so the agent is idle when it happens. It still must not keep working from stale knowledge.
- The daemon records a `RestoredToMessage` event. Every CLI command (`next`, `reply`, `resolve`, `wait`) prints a NOTICE block first if a restore happened since that agent's last call: which message the project was restored to, the time, the files that changed, and which threads were discarded ("do not continue t_5"). The notice repeats until the agent runs `tackboard ack`.
- The notice tells the agent to re-read files before editing, because anything it remembers about them may be wrong.
- Limit: an agent that is not calling the CLI learns nothing until its next call. Pushing it (Claude Code hook or channel) is a later option.

### Mapping a page element to React source (**[my call]**)
A DOM selector alone is weak for React. Layered, best effort, each layer optional:
1. **Component names from the React fiber** (read from the DOM node's fiber): gives a chain like `PricingPage > PlanCard > Button`. Works in dev. Names are mangled in production builds.
2. **Source file and line from a dev-only build plugin** (Babel/SWC or Vite/Next plugin adds a `data-tb-src="src/components/PlanCard.tsx:48"` attribute in dev). Needed because newer React versions no longer expose source locations on the fiber (verify against the React version in use).
3. **Fallback:** the element's HTML snippet, visible text, and classes, so the agent can search the code for them.
The payload carries a `confidence` field (source / component / text-only), and the agent instructions say what to do at each level. `ElementPath` in the overlay can show component names next to tags.

## 18. Overlay UI (from the clickable mock; supersedes earlier UI wording)
Mock: https://claude.ai/artifact/Uqxcd6FxXnW59ZgLarPnp4 (private). Each piece is one overlay component.

- **ModeSwitch**: icon-only dark pill, bottom-right. Eye-off = hidden, eye = view, dashed box with cursor = comment. A divider, then a chat icon (**PanelToggle**) with an amber count of threads waiting on the user or unread. Room for a fourth tool in v2 (drag-select).
- **HoverOutline + ElementPath** (comment mode): the outline starts on the innermost element under the cursor. A path bar lists its ancestors outermost first. ArrowUp/ArrowDown or hovering a crumb moves the outline through nested parents; clicking a crumb or the page comments on that level. The root page container is not selectable.
- **CommentsPanel**: a floating window, not attached to the pill. Draggable by its header, closable with an X or the chat icon, closed by default. Opens by itself when a comment is started, sent, or a pin is clicked.
- **Panel contents**: Open / Resolved tabs; collapsed one-line **ThreadItem**s (pin number, target, status chip, preview); one thread open at a time with chat bubbles (user right, agent left in teal) and a reply box. **Composer** sits inside the panel **[my call: not a popover at the element]**.
- **Scroll links**: clicking a thread scrolls the page to its element, outlines it and pulses its pin; clicking a pin opens its thread. Pins hide while their element is off screen.
- **Other components**: Pin, StatusChip, AgentBadge, Message, RestorePoint, RestoreConfirm, PermissionBanner, EmptyState, DetachedList, Toast, MentionMenu (v2).
- Status labels: pending, received, waiting on you, resolved; discarded for restored-over messages.
