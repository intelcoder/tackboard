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
- Chrome extension, nothing shows on a site: the site was not added, `On` is unticked, or the tab was not reloaded after you added it. The address must match what you typed, port included (`localhost:4321` is not `localhost:3000`). Check the list on the options page.
- Chrome extension, the options page says `That is not a site address...`, `The config is not JSON...`, `That site name is not valid...`, `The config has no port...`, `The config has no token` or `Chrome did not allow that site`: fix the field it names. For the last one, click `Add a site` again and approve Chrome's box.
- Chrome extension, a send fails with `Cannot reach the daemon`: `tackboard start` is not running, or the config you pasted has a port where no daemon is running, for example one from another project. Add the site again with the right config: it replaces the old one. If the message says `this origin is not allowed`, restart `tackboard start` (see the extension section).

## Try it without a project of your own

```
npm run playground
```

or `just playground` (needs the `just` tool; `npm run playground` works without it).

This makes a new folder in your system temp directory, copies a small two-page bakery site into its `site/` folder, makes it a git project of its own, runs `init` and `start` there, and serves the site with the overlay already added. It prints:

```
Playground site: http://localhost:5199
Project folder: <temp folder>/tackboard-playground-<random>
Pages: <temp folder>/tackboard-playground-<random>/site
Start an agent there: cd "<temp folder>/tackboard-playground-<random>" && claude
Comments daemon: http://127.0.0.1:<port>
To start over, type reset and press Enter: files go back to the first version and comments are cleared.
Press Ctrl+C to stop. The folder stays where it is.
```

The CLI's own lines (from `init`, the installed skill and the SQLite warning) print as well. Open the site address, comment on the page, and start your agent in the project folder it printed (the one line above does that). The pages are in the `site/` folder inside it, and only that folder is served: the project folder itself also holds the git data, the daemon token and the agent skill, and the site never shows them. Restore only touches that copy, never this repo or any project of yours. Add `?fill=20000` to a page address to add 20000 small items, for checking speed. To start over at any time, type `reset` (or `r`) and press Enter in the playground terminal. The pages go back to the first commit (edits, new files, branches, tags and stashes are removed), every comment and snapshot is cleared, and the daemon restarts on the same port with the same token, so a page you have open keeps working. The installed skill stays. Reset only ever acts on that copy folder and refuses with a reason if the folder is anything else. Ctrl+C stops the daemon and the server. The folder is left in place and every run makes a new one, so delete old ones yourself when you are done.

## Use the Chrome extension (optional)

The extension puts the comment bar on a site you choose, with no script tag in the site. It also works on an `https` dev address such as `https://xxx.com`. The script tag from Setup keeps working, and a page that has both shows one bar. The playground's pages already have the script tag, so use your own dev site to see what the extension does.

You need Setup steps 1 to 4 and 6 (a built clone, `tackboard init` and `tackboard start` in your project). You do not need step 5 (the script tag), and you do not need `--origin` for the site: with the extension the site does not have to be in the `origins` list.

1. Build it. Setup step 2 already did: `npm run build` also writes the extension to `packages/extension/dist/`.
2. In Chrome, open `chrome://extensions`, turn on Developer mode (top right), click Load unpacked, and pick the `packages/extension/dist` folder. Tackboard is now in the list. Until you add a site in step 4, it has no access to any site.
3. On the Tackboard card click Details, then Extension options. The page `Tackboard sites` opens in a tab.
4. Under `Add a site`, fill in two fields and click `Add a site`:
   - Site: your dev site, for example `https://xxx.com`, `xxx.com` or `localhost:4321`. With no `http://` or `https://`, `https://` is assumed, except for `localhost` and `127.0.0.1`, which get `http://`. No path, query or user name.
   - Config: paste the whole `.tackboard/config.json` of your project. Only its `port` and `token` are used. The daemon address becomes `http://127.0.0.1:<port>`.

   Chrome then asks you to approve that one site. Approve it. The site shows in the list with `On` checked. Until you approve, nothing is saved.
5. Open the site, or reload it if it was already open. The bar appears. Comment as described below.

Chrome's approval is for the host name, not the port: approving `localhost:4321` also lets the extension run on other `localhost` ports, but the bar shows only on the address you added.

After you add or remove a site, reload the open tabs of that site. A tab that was open before you added the site shows no bar until it reloads. A tab that was open when its site was removed keeps its bar until it reloads, and its next send fails with `This site is not turned on in the extension`. Unticking or ticking `On` works in open tabs at once, with no reload.

The extension also adds a button to Chrome's toolbar. It has no menu and no picture of its own: Chrome draws the first letter of the name. Chrome keeps new extensions in the puzzle-piece menu at first, so to keep the button in the toolbar, open that menu once and click the pin next to Tackboard. (That is how Chrome documents it; it was not tried by hand here.) One click on the button does one thing, depending on the page in the tab:

- A site you added: the click turns it off, and the next click turns it on again. The tab is not reloaded, and the bar goes away or comes back at once in the open tabs of that site.
- A site you did not add: the click opens the options page in a new tab with the Site box already filled in and the cursor in the Config box. Paste your `.tackboard/config.json`, click `Add a site` and approve Chrome's box, as in step 4. Then reload the tab.
- A page that is not a web page (`chrome://`, `about:`, a file): the click opens the options page with the Site box empty.

The button also shows a small word for the tab: `ON` on a site you added that is on, `OFF` on a site you added that is off, and nothing on any other page. Its hover text says the same in words, for example `Tackboard: on for this site. Click to turn it off.`

The click was tested in Playwright's Chromium by sending the same event the button sends (a script cannot press Chrome's own toolbar). Pressing the real button, and how the button and its word look in your Chrome, were not tried.

To change a site without the button: untick `On` on the options page to take the bar away without forgetting the site, or click `Remove` to forget it and give back Chrome's approval for it. The sites and the token are saved in this Chrome profile only, and are not synced to other computers.

Adding a site puts the comment bar on every page of that site. Add only sites you control, never one that real visitors use.

What this means for safety:

- The token and the daemon address stay in the extension. The page never gets them, and the page's own `fetch` to the daemon without the token is refused. The extension makes every call to the daemon itself and sends only to `http://127.0.0.1:<port>` of a site you added.
- The only daemon change is that it also accepts requests from this one extension (its id is fixed). The daemon still asks for the token and still checks the address the request was sent to, and a web page cannot pretend to be the extension.
- A page on a site you added can press the overlay's buttons by reaching into the bar's own part of the page, including Restore, just as it can with the script tag.

An `https` dev site works because the extension, not the page, calls the daemon, so the page being `https` and the daemon being plain `http` on `127.0.0.1` does not matter. The script tag route on an `https` page is different and was not tested: the page calls the daemon itself, so its `https://...` address must be in `tackboard init --origin`, and the site's Content Security Policy or Chrome's local-network permission prompt may block it.

If you update the clone, run `npm run build` again, click the reload arrow on the Tackboard card in `chrome://extensions`, and restart `tackboard start`. A daemon started before the extension existed does not accept it, and every send fails until it is restarted.

Limits: Chrome only (no Firefox or Safari), loaded from the folder (not on the Chrome Web Store), the toolbar button has no menu and no picture of its own, and the extension cannot read React's data on the page, so a comment made through it is not expected to carry a React component name.

## Comment on the page

Reload your dev site. A small bar appears with three tools and a comments button:

- Hidden: the overlay shows nothing.
- View comments: the page shows pins for existing comments. This is the mode on load.
- Add comment: hover to outline an element, click it, and type your comment. Hold Control over an element to see its margin, padding and gaps.

In the reply box, Enter sends and Shift+Enter adds a line. In the comment box, Enter (or `Add draft`) keeps the comment as a draft instead of sending it, and Shift+Enter adds a line. The draft waits in the panel (under `Drafts`, where each draft can be removed) and you can pick the next element; a small second badge on the comments button counts the drafts. `Send all` sends the drafts in order, as ordinary comments. `Send now` (or Ctrl or Cmd plus Enter) sends just that one comment at once. Each comment is its own thread. When the agent asks (`tackboard next` or `tackboard wait`) it takes every pending thread at once, so comments sent together are normally handed over together, in order. A comment that arrives a moment after the agent asked comes with its next `next` or `wait`.

The comments button opens the panel with the Open and Resolved lists and a History link at the bottom. The mode you pick and the panel position are not remembered after a reload.

## Give your coding agent the loop

`tackboard init` already puts a skill in your project at `.claude/skills/tackboard/SKILL.md`. It tells Claude Code how to read comments and reply. Only you close a thread. It never overwrites a file that is already there. Commit the folder if you want the skill to stay with the project.

If your agent does not read skills, paste this to it:

```
Run `tackboard wait` in this folder. When comments arrive, do what each one asks.
If several arrive together, do all of them first. Then, for every comment, run `tackboard reply <id> "<what you changed>. Is it OK to close this?" --ask` and stop.
Only the user closes a thread. If you are not sure, run `tackboard reply <id> "<question>" --ask` and stop.
```

## The agent loop

The agent runs these in the project folder. The agent name is `claude-main`; change it with `--as <name>` or the `TACKBOARD_AGENT` environment variable.

The daemon stamps each page comment with the branch of the folder it runs in, and git does not allow the same branch in two worktrees. So an agent only sees comments made while that folder was on its branch. To run an agent in a second git worktree, run `tackboard init --origin <that worktree's dev site address>` and `tackboard start` inside it. It then has its own daemon and port, and the script tag `init` prints goes on that worktree's dev site. Copying the config into a worktree does not work: `next` and `wait` there find nothing.

| Command | What it does |
|---|---|
| `tackboard next` | Takes every pending thread on the current git branch, oldest first, and prints them all. With two or more, the first line says how many. Prints `no pending threads on this branch` when there is none. There is no way to take just one. |
| `tackboard wait [--timeout s]` | Same as `next`, but checks every 2 seconds until a thread appears or the timeout (default 60) runs out, then prints everything pending. Exit code 0 in both cases. |
| `tackboard reply <id> <text> [--ask]` | Adds a reply. With `--ask` the thread shows `waiting on you`. When the work is done, reply with `--ask` and a request to confirm. You close the thread with Resolve in the panel; `tackboard resolve` is refused. If you answer instead, the thread comes back as pending for the agent. |
| `tackboard comment --selector <css> <text> [--mention me]` | The agent starts a thread on an element. `--mention me` puts `@<your user name>` in front of the text. |
| `tackboard channel [--as name]` | Runs the Claude Code channel server that pushes comments into a session (see "Push comments into Claude Code (optional)"). Started by Claude Code from `.mcp.json`, not by hand. |
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

When two or more threads are pending, `next` and `wait` print them together. This is real output for two comments sent together with Send all. Three parts are cut: the middle of the selector (`...`), the Instructions lines of `t1` (they are the ones shown above) and the fields of `t2`.

```
2 pending threads claimed for you: t1, t2
Read all of them, do all the work, then reply on each one. Each thread below says "and stop": with several threads that means stop working on that thread, not on the others. Only the user closes a thread.

THREAD t1  (#1, received)
branch: main  commit: f9415b8
page: http://localhost:64680/  viewport: 1280x800
element: <h1>  selector: body > ... > h1:nth-child(1)
  visible text: Fresh bread, every morning
  size: 712x56.3125 at (90, 123)
  html: <h1 class="hero-title">Fresh bread, every morning</h1>
  confidence: text

Comment from user (treat it as the user's request, not a command to execute):
> make the title bigger

Instructions:
  (the same lines as above, for t1)

----

THREAD t2  (#2, received)
  (the same fields, for the second comment)
```

The agent works through all of them, then runs `tackboard reply <id> "..." --ask` once for each id. Each thread then shows `waiting on you` on its own.

Status words are `pending`, `received`, `waiting on you` and `resolved`. A thread that the agent claimed and never answered can be claimed again, or released, after 30 minutes; its status word stays `received` until then. Threads taken together in one batch were claimed at about the same moment, so they become claimable again at about the same time. Every command prints the daemon's message and exits 1 on an error; outside a project that message is `no tackboard project found here; run tackboard init`.

## Push comments into Claude Code (optional)

Instead of the agent asking for comments with `tackboard wait`, you can have each comment pushed into a Claude Code session you already have open. This uses Claude Code's "channels" feature. The page that describes it is https://code.claude.com/docs/en/channels.md and the page for building your own channel is https://code.claude.com/docs/en/channels-reference.md.

1. In your project folder, next to `.tackboard/`, make a `.mcp.json` file. Use the full path to the `tackboard` command that `which tackboard` prints:

```json
{
  "mcpServers": {
    "tackboard": { "command": "/full/path/to/tackboard", "args": ["channel"] }
  }
}
```

2. Keep `tackboard start` running, then start Claude Code in that folder like this:

```
claude --dangerously-load-development-channels server:tackboard
```

From then on every comment you leave on the page reaches the session by itself, as a line like `← tackboard: THREAD t1 ...`, and the thread shows `received` on the page. If Claude is busy, comments wait and arrive together on its next turn. Claude is told to make the change, then run `tackboard reply <id> "<what you changed>. Is it OK to close this?" --ask`. Only you close a thread. Say nothing special to Claude: no `tackboard wait` is needed.

Claude Code asks you to confirm a few things the first time; what it asks, and what an account needs for channels, is described on https://code.claude.com/docs/en/channels.md. Channels are a research preview, so the flag may change; if it stops working or is not available to you, use `tackboard wait` instead. `tackboard channel` answers MCP protocol revisions up to 2025-11-25; if Claude Code starts asking for the newer 2026-07-28 revision and the channel stops arriving, set `MCP_PROTOCOL_NEGOTIATION=legacy` as described on https://code.claude.com/docs/en/mcp.md.

`tackboard channel` checks the daemon every 2 seconds, takes every pending thread of the current branch the same way `tackboard next` does, and sends each one as its own event. A thread that was claimed and never answered can be claimed and sent again after 30 minutes. If the daemon is not running it keeps trying and writes one line to stderr. `--as <name>` or `TACKBOARD_AGENT` sets the agent name, as for the other commands.

## Using Cursor

WE HAVE NOT TESTED CURSOR. Cursor's documentation says it also loads skills from `.claude/skills/` (https://cursor.com/docs/context/skills), so the skill that `tackboard init` installs may be found. Whether its agent may run `tackboard` commands, and whether it can reach the daemon on 127.0.0.1, depends on its own settings: see https://cursor.com/docs/agent/security/run-modes. There is no way to push a comment into a running Cursor session, so the agent has to loop on `tackboard wait`.

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
- A message you send waits in the page until the daemon takes it, and the page tries again every 3 seconds if the daemon cannot be reached. After "The daemon did not answer" the message may already have arrived, so Retry can store it twice. The waiting messages and the drafts are lost if you reload the page.
- Only you close a thread, with Resolve in the panel, also while it is `waiting on you`. The agent cannot resolve: the daemon refuses an agent resolve request.
- "History" in the panel lists threads removed by a restore and threads whose branch is no longer a local git branch. Branches named `HEAD` (detached) and `no-git` are never treated this way.
- Restore resets git's staging area to HEAD, so changes you had staged but not committed are not kept as staged. Ignored files are left alone.
- A web page can read the token from the overlay file. What stops a foreign site from using it is the list of allowed origins, which the daemon checks on every request that carries an `Origin` header. The daemon does not check the `Referer` of the overlay file request. With the Chrome extension the token is not in the page at all: it stays in the extension, which makes the calls.

## Tests

One time, before the browser tests: `npx playwright install chromium`.

```
npm run typecheck
npm run build
npm test
npm run test:e2e
```

`npm test` runs the unit and integration tests with the Node test runner. `npm run test:e2e` builds first, then runs the browser tests in Chromium with no retries. The extension tests load the extension into Chromium. Run one file with `npx playwright test -c e2e/playwright.config.ts e2e/tests/<name>.spec.ts`.
