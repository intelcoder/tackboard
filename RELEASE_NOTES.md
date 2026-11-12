# Release notes

## Unreleased: connecting the agent is easier, and you can see why it is not

Before: the toolbar button said ON while the panel said the agent was not connected, and an agent sometimes needed several tries to see a comment. Now every place that shows the agent agrees, says why, and has a command to check it.

### New

- **`tackboard doctor`** checks the daemon, folder, branch, extension, skill and agent, and prints the command that fixes each one that is off.
- **Agent state everywhere.** The panel pill, `tackboard status`, `doctor` and the toolbar button use one definition: `listening` (asked in the last 8 s), `idle` (within 10 min), `away` (longer ago) or `none` (never). The pill's tooltip says what that means and what to run.
- **Toolbar button states.** Green `ON` when an agent is listening or idle. Amber `ON?` when the site is on but no agent is. Red `!` when the daemon cannot be reached or refused the token.
- **"claude-code is connected" toast**, once per agent per page, when an agent first asks for comments.
- **Dev-mode log.** Start the daemon with `TACKBOARD_DEBUG=1` and read it with `tackboard logs [-f]`. When `next` or `wait` finds nothing, the answer now says why (for example, comments waiting on another branch or another page).
- **`next --url <path>` and `wait --url <path>`** take only the comments from one page. The panel's footer has **Copy agent prompt**, which copies a prompt that includes the command for the page you are on. Without `--url`, everything on the branch is taken, as before.
- **Options page redesign.** Cards for Sites, Other sites, Screenshots and Shortcuts; a Local or Added tag on each site; a clear first-run message; shortcuts shown for Mac or other systems; works at 320 px in light and dark.

### Changed

- **One port per project.** `tackboard init` gives each project the first free port from 47800 to 47809. The extension asks all ten and pairs a page with the daemon whose allowed origins include it. With several daemons and no match it pairs nothing rather than guess. Projects set up earlier keep their port.
- **A wrong token now names the cause**: "the daemon on port N did not accept this folder's token, so it belongs to another project… run `tackboard doctor`."
- `/pair` and `/health` give the extension a little more (allowed origins, when the extension last paired). No token or comment text is added.

### Known limits

- "Listening" is a good guess, not proof of an open `wait`; any CLI command counts as the agent asking.
- Two tabs on the same page path share their comments; real tab IDs are not built.
- A project whose port is outside 47800 to 47809 is not found by the extension's scan.
- Not tried by hand: the real Chrome toolbar click and approval box. The checks ran in Playwright's Chromium.
