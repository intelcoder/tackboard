# 003 Page errors on a comment

## Problem
"It's broken" comes with no clue why. The agent sees the element, not the red console line or the failed request behind it.

## What the user gets
Under the comment box, next to **Attach screenshot**: **Attach page errors (N)**. N is how many errors and failed requests the page has had since it loaded. Off by default, disabled with "none since the page loaded" when N is 0. When ticked and sent (Send now or a draft), the comment carries them. `tackboard next` prints them under the element block.

## What is recorded
A small recorder runs in the page's own JavaScript world from the start of the page (an extension script with `world: "MAIN"` at `document_start`). It keeps the last 20 of:
- `error`: `console.error`, an uncaught error, an unhandled promise rejection.
- `warn`: `console.warn`.
- `network`: a `fetch` or XHR that failed or answered 400 or more, as `GET /api/orders 500` (path only, never the query string; another host keeps its host).

Each line is cut to 300 characters. Nothing else is recorded: no request or response bodies, no headers, no successful requests, no `console.log`.

## Scope
- Extension route only, like screenshots. The overlay (in the extension's separate world) asks the recorder with a DOM event and gets the lines back as a JSON string. Without a recorder there is no checkbox. The script-tag route has none.
- Page errors belong to the whole page, not the element, but are stored on the element (JSON, so no database change): `element.pageErrors?: { kind, text }[]`.
- Only the first message of a thread carries them.
- A page that was open before the extension reloaded has no recorder until it is reloaded; the checkbox is not shown there.

## Data
- `PostThreadRequest.pageErrors?: PageError[]`. The daemon keeps at most 20, drops lines with an unknown `kind` or a non-text `text`, and cuts `text` to 300 characters. A client-supplied `element.pageErrors` is dropped; only this field counts.
- CLI: `page errors:` then one `  error|warn|network: <text>` line each, under the element block.

## Risks
Console text can hold private data (a token in an error message). That is why it is a tick per comment, with the count shown, and why no bodies or query strings are recorded.

## Not in this feature
Console `log`/`info`/`debug`, request bodies, a live console, errors after the comment is sent, replies carrying errors, the script-tag route.

## Done when
- A comment with the box ticked stores the errors; `next` prints them; without the box nothing changes.
- A real page that logs `console.error`, throws, and calls a failing `fetch` shows N = 3 and the agent gets all three.
- Daemon limits and the unknown-kind case are covered by tests.
