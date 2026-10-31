# 004 One comment, more than one element

## Problem
"These three cards do not line up" is one complaint about several elements. Today the user must leave three comments, and the agent fixes them one at a time with no idea they belong together.

## What the user gets
In the comment box, **+ Add another element**. It hands the page back to picking: click one more element and it comes back to the box as a chip (removable with its ✕), with the typed text kept. Up to 5 more. Esc while picking gives the box back unchanged. Picking an element that is already in the comment adds nothing.

## What the agent gets
The first element as today, then one line per extra: `also this element: <tag>  selector: …  text: …  source: …` (`tackboard next`). The comment text is one message about all of them.

## Data
- `PostThreadRequest.also?: ElementRef[]`, stored as `element.also` (JSON, no database change). The daemon reads each like the first (cuts `html` and `text`), drops the broken ones, keeps at most 5, and ignores a client-supplied `element.also`, `screenshot` or `pageErrors` inside them.
- A screenshot covers the area around all the elements together (one picture).

## Not in this feature
Pins on the extra elements (the pin stays on the first), outlining the extras on the page while the box is open, drag-to-select an area, extras on replies, extras in the thread rows of the panel.

## Done when
- A comment with two elements reaches `next` with the `also this element` line; one element is unchanged.
- Remove, Esc, and picking the same element twice behave as written (e2e `multi_element.spec.ts`).
- The screenshot of two elements is as big as the area around both (e2e in `extension.spec.ts`).
