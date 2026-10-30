# 002 Screenshot on request

## Problem
The agent gets the element's HTML, selector and text, but cannot see what the user sees. Visual complaints ("too tight", "wrong colour", "overlaps the nav") are guessed at.

## What the user gets
In the comment box there is an **Attach screenshot** checkbox. Off by default. When it is on and the user sends (Send now or a draft), the comment carries a picture of that element, cropped from what is on screen. The panel shows a small thumbnail on the thread. `tackboard next` prints the file path, so the agent can open the image.

## Scope
- Extension route only. The overlay asks the extension background to capture the visible tab (`chrome.tabs.captureVisibleTab`, already allowed by `activeTab` and the host permissions), then crops to the element's rect times `devicePixelRatio`.
- The overlay hides itself for the frame it captures.
- One screenshot per comment (the first message of a thread). Replies do not take one.
- The script-tag route has no way to capture a tab. The checkbox is not shown there.
- A comment whose element is not on screen (scrolled away, zero size) gets the checkbox disabled with the words "Scroll the element into view to attach a screenshot".

## Data
- `PostThreadRequest.screenshot?: string` — base64 PNG, at most 1.5 MB after decoding. A larger one is refused with `too_large`.
- The daemon writes it to `.tackboard/shots/<threadId>.png` and keeps the file, so it survives restore.
- `ThreadDto.element.screenshot?: string` — the path relative to the project. Served to the panel through `GET /threads/:id/screenshot` (token required) so the page never needs file access.
- CLI: `tackboard next` and `wait` print `Screenshot: <absolute path>` under the element block.

## Not in this feature
Full-page capture, screenshots on replies, screenshots taken later or by the agent, annotation or drawing on the image, console and network errors (next spec, 003), and the script-tag route.

## Risks to check in real Chrome
1. `captureVisibleTab` from the background on a page that was not added (needs `activeTab`, which a comment click may not grant).
2. The crop box with a zoomed page, a retina screen, a scrolled container and an iframe.
3. The overlay really is gone from the captured frame (wait one frame after hiding).
4. A PNG over 1.5 MB on a large element: downscale to the limit or refuse with a clear line.

## Done when
- A comment with the box ticked stores a PNG that shows the element and none of the overlay; `tackboard next` prints its path; the panel shows the thumbnail.
- A comment without the box is unchanged: same request, same output.
- The oversize, off-screen and script-tag cases behave as written above.
- Checked once by hand in real Chrome (the gap in BACKLOG.md).
