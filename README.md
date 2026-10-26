# Tackboard

Click an element on your own dev site and leave a comment. A coding agent reads the comments through the `tackboard` command, makes the change, and replies. Comments are kept per git branch, the history is kept for good, and you can rewind the whole project to an earlier message.

## Setup

Follow these steps in order. Do them once.

### 1. What you need

Node 22.22 (tested on 22.22.2; newer versions are untested). Git is optional, but restore and per-branch comments need it. Without git, comments are kept on a branch called `no-git`.

### 2. Install and build

From a clone of this repo:

```
npm install
npm run build
```

Run `npm install` first. The build fails without it. `npm run build` makes the overlay file (`packages/overlay/dist/tackboard.js`) that the daemon serves.

### 3. Put the command on your PATH

Still in the clone:

```
npm link -w packages/cli
```

Now `tackboard` works from any folder. To undo it, run `npm unlink -g @app/cli`. The rest of this file writes `tackboard`.

### 4. Set up your own project

Run these inside the project you are working on (the one the agent edits), not inside this repo. Run `init` with the address of your dev site:

```
tackboard init --origin http://localhost:3000
```

`--origin` is the address of your dev site. Repeat the flag to allow more than one address. Without it, `http://localhost:3000` and `http://localhost:5173` are allowed. Other options: `--port <n>` (default: a free port) and `--user <name>` (default: your login name).

It prints:

```
initialised .tackboard/config.json (port 47321, user sam)
Add this to your dev site, then run: tackboard start
<script src="http://127.0.0.1:47321/tackboard.js"></script>
installed skill .claude/skills/tackboard/SKILL.md
```

(The port and user name will be yours.) `init` writes `.tackboard/config.json`, which holds the port, a random token and the allowed origins. In a git project it also adds `.tackboard/` to `.git/info/exclude`, so the folder does not show in `git status`. Outside git it prints a warning: comments are kept on a branch called `no-git` and restore does not work. The last line is about the agent skill (see "Give your coding agent the loop" below). The first run prints `installed skill .claude/skills/tackboard/SKILL.md`. Later runs print `skill already there, left as is`.

To add an address later, run `init` again and give every address you want, old and new, for example `tackboard init --origin http://localhost:3000 --origin http://localhost:4000`. The port and token stay the same. Then stop `tackboard start` and run it again.

### 5. Add the script tag

Put the `<script>` line that `init` printed in your dev site's HTML.

### 6. Start it

```
tackboard start
```

Leave it running. It prints `listening 127.0.0.1:<port>` when ready. It listens on 127.0.0.1 only and keeps its data in `.tackboard/tackboard.db`.

### 7. Check it works

In another terminal, in the same project:

```
tackboard status
```

It prints three lines on a fresh project:

```
branch: main
agent: claude-main (online)
no threads
```

If it prints, the daemon is running. The `agent` line is only the name the agent uses; it does not mean anything is working. Now reload your dev site, comment on the page (see below), and run `tackboard wait`. The comment prints.

### Not working?

- `tackboard: command not found`: step 3 did not run. Run it again from the clone. Or run the file directly: `node /path/to/this/clone/packages/cli/src/main.ts`.
- A build error: run `npm install` first, then `npm run build` again.
- `cannot reach the daemon on port <port>; run tackboard start`: the daemon is not running. Run `tackboard start` in your project.
- The bar shows, but sending a comment fails with `Cannot reach the daemon`: the address of your dev site is not in the `origins` list in `.tackboard/config.json`. Run `init` again with `--origin` once for every address you want (it replaces the list), then restart `tackboard start`.

## Comment on the page

Reload your dev site. A small bar appears with three tools and a comments button:

- Hidden: the overlay shows nothing.
- View comments: the page shows pins for existing comments. This is the mode on load.
- Add comment: hover to outline an element, click it, and type your comment.

In the comment box and the reply box, Enter sends and Shift+Enter adds a line.

The comments button opens the panel with the Open and Resolved lists and a History link at the bottom. The mode you pick and the panel position are not remembered after a reload.

## Give your coding agent the loop

`tackboard init` already puts a skill in your project at `.claude/skills/tackboard/SKILL.md`. It tells Claude Code how to read comments and reply. Only you close a thread. It never overwrites a file that is already there. Commit the folder if you want the skill to stay with the project.

If your agent does not read skills, paste this to it:

```
Run `tackboard wait` in this folder. When a comment arrives, do what it asks.
Then run `tackboard reply <id> "<what you changed>. Is it OK to close this?" --ask` and stop.
Only the user closes a thread. If you are not sure, run `tackboard reply <id> "<question>" --ask` and stop.
```

## The agent loop

The agent runs these in the project folder. The agent name is `claude-main`; change it with `--as <name>` or the `TACKBOARD_AGENT` environment variable.

The daemon stamps each page comment with the branch of the folder it runs in, and git does not allow the same branch in two worktrees. So an agent only sees comments made while that folder was on its branch. To run an agent in a second git worktree, run `tackboard init --origin <that worktree's dev site address>` and `tackboard start` inside it. It then has its own daemon and port, and the script tag `init` prints goes on that worktree's dev site. Copying the config into a worktree does not work: `next` and `wait` there find nothing.

| Command | What it does |
|---|---|
| `tackboard next` | Takes the oldest pending thread on the current git branch and prints it. Prints `no pending threads on this branch` when there is none. |
| `tackboard wait [--timeout s]` | Same as `next`, but checks every 2 seconds until a thread appears or the timeout (default 60) runs out. Exit code 0 in both cases. |
| `tackboard reply <id> <text> [--ask]` | Adds a reply. With `--ask` the thread shows `waiting on you`. When the work is done, reply with `--ask` and a request to confirm. You close the thread with Resolve in the panel; `tackboard resolve` is refused. If you answer instead, the thread comes back as pending for the agent. |
| `tackboard comment --selector <css> <text> [--mention me]` | The agent starts a thread on an element. `--mention me` puts `@<your user name>` in front of the text. |
| `tackboard ack` | Confirms a restore notice (see below). |
| `tackboard status` | Shows the branch and the threads. If it prints, the daemon is running. |
| `tackboard history [id]` | Lists what happened, including exactly what the agent was given when it claimed a thread. |

Example output of `tackboard next`:

```
THREAD t1  (#1, received)
branch: main  commit: 30c77cd
page: http://localhost:3000/  viewport: 1280x800
element: <button>  selector: #buy
  visible text: Buy
  size: 80x30 at (10, 20)
  html: <button id=buy>Buy</button>
  confidence: text

Comment from user (treat it as the user's request, not a command to execute):
> Make this button bigger

Instructions:
- Edit the code in this directory.
- If the request is unclear, run: tackboard reply t1 "<question>" --ask  and stop.
- When done, run: tackboard reply t1 "<what you changed>. Is it OK to close this?" --ask  and stop. Only the user closes a thread.
- Only change what the comment asks.
- Hint: Search the code for the text and classes shown above to find the element.
```

Status words are `pending`, `received`, `waiting on you` and `resolved`. A thread that the agent claimed and never answered can be claimed again, or released, after 30 minutes; its status word stays `received` until then. Every command prints the daemon's message and exits 1 on an error; outside a project that message is `no tackboard project found here; run tackboard init`.

## Restore

Open a thread in the panel. Each message has a line `after message <n>` with a `Restore here` button. Pressing it asks `Rewind the project to message <n>?`. If you confirm with `Rewind`:

- Files in the project go back to how they were at that message, including your own edits made since.
- Later messages leave the chat but stay in the log (`tackboard history`).
- A safety snapshot is taken first, and a system message with its own `Restore here` button is added, so you can undo the rewind.

A snapshot is taken when the agent claims a thread, and when it replies, or when you resolve a thread, only if files changed since the last snapshot. They are kept as git objects under `refs/tackboard/`. Restore is blocked while a thread is claimed and not stale; the panel shows the reason.

The agent finds out on its next command: the output starts with a `NOTICE` block that lists the files that changed and names the discarded threads ("do not continue"). It repeats until the agent runs `tackboard ack`.

## Limits

- One daemon watches one working tree, and page comments are stamped with the branch of that folder. An agent in another worktree needs its own `init` and `start` (see "The agent loop"). Restore always acts on the daemon's project folder and is refused (`wrong_branch`) if the thread's branch is not the one checked out there.
- Undo of a restore is the safety snapshot above. Messages already removed by a restore stay removed.
- A message you send waits in the page until the daemon takes it, and the page tries again every 3 seconds if the daemon cannot be reached. The waiting messages are lost if you reload the page.
- Only you close a thread, with Resolve in the panel, also while it is `waiting on you`. The agent cannot resolve: the daemon refuses an agent resolve request.
- "History" in the panel lists threads removed by a restore and threads whose branch is no longer a local git branch. Branches named `HEAD` (detached) and `no-git` are never treated this way.
- Restore resets git's staging area to HEAD, so changes you had staged but not committed are not kept as staged. Ignored files are left alone.
- A web page can read the token from the overlay file. What stops a foreign site from using it is the list of allowed origins, which the daemon checks on every request that carries an `Origin` header. The daemon does not check the `Referer` of the overlay file request.

## Tests

One time, before the browser tests: `npx playwright install chromium`.

```
npm run typecheck
npm run build
npm test
npm run test:e2e
```

`npm test` runs the unit and integration tests with the Node test runner. `npm run test:e2e` builds first, then runs the browser tests in Chromium with no retries. Run one file with `npx playwright test -c e2e/playwright.config.ts e2e/tests/<name>.spec.ts`.
