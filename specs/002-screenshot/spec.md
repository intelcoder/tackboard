# 002 Screenshot on request

## Problem
The agent gets the element's HTML, selector and text, but cannot see what the user sees. Visual complaints ("too tight", "wrong colour", "overlaps the nav") are guessed at.

## What the user gets
In the comment box there is an **Attach screenshot** checkbox. Off by default. When it is on and the user sends (Send now or a draft), the comment carries a picture of that element, cropped from what is on screen. `tackboard next` prints the file path, so the agent can open the image.

## Scope
- Extension route only. The overlay asks the extension background to capture the visible tab (`chrome.tabs.captureVisibleTab`, which needs the optional `<all_urls>` permission, see Risks), then crops to the element's rect times `devicePixelRatio`.
- The overlay hides itself for the frame it captures.
- One screenshot per comment (the first message of a thread). Replies do not take one.
- The script-tag route has no way to capture a tab. The checkbox is not shown there.
- A comment whose element is not on screen (scrolled away, zero size) gets the checkbox disabled with the words "Scroll the element into view to attach a screenshot".

## Data
- `PostThreadRequest.screenshot?: string` — base64 PNG, at most 1,000,000 bytes after decoding (so its base64 text fits the 2 MB body limit). A larger one is refused with `too_large`.
- The daemon writes it to `.tackboard/shots/<threadId>.png` and keeps the file, so it survives restore.
- `ThreadDto.element.screenshot?: string` — the path relative to the project, set only by the daemon (a client-supplied value is dropped). No panel thumbnail: the extension passes daemon answers as text, so the file cannot be shown there.
- CLI: `tackboard next` and `wait` print `screenshot: .tackboard/shots/<id>.png` under the element block (a path from the project folder, where the agent runs).

## Not in this feature
Full-page capture, screenshots on replies, screenshots taken later or by the agent, annotation or drawing on the image, console and network errors (next spec, 003), and the script-tag route.

## Risks to check in real Chrome
1. **Found by the browser test:** `captureVisibleTab` needs `<all_urls>` (or `activeTab` from a toolbar click); per-site access is not enough. Built as an opt-in: `<all_urls>` is an optional permission and the options page has an **Allow screenshots** switch. Until it is on, ticking the box shows a plain message and the comment is not sent.
2. The crop box with a zoomed page, a retina screen, a scrolled container and an iframe.
3. The overlay really is gone from the captured frame (wait one frame after hiding).
4. A PNG over the limit on a large element: the overlay downscales it step by step, and refuses with a clear line below 20% size.

## Done when
- A comment with the box ticked stores a PNG that shows the element and none of the overlay; `tackboard next` prints its path.
- A comment without the box is unchanged: same request, same output.
- The oversize, off-screen and script-tag cases behave as written above.
- Checked once by hand in real Chrome (the gap in BACKLOG.md), including the **Allow screenshots** approval box.
