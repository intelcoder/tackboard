import { brand, statusLabel } from "@app/shared";
import type { ThreadDto, Notice } from "@app/shared";

const HINTS = {
  source: "The element's source location is known: open that file and line first.",
  component: "Search for the component names listed above to find the code.",
  text: "Search the code for the text and classes shown above to find the element.",
} as const;

function clip(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}...` : s;
}

/**
 * The markup as the agent needs it: our own source attribute (the `source:` line says it already) left out, long attribute
 * values cut to their start with their length, whitespace between tags dropped. The stored copy is not changed.
 */
export function compactHtml(html: string): string {
  return html
    .replace(new RegExp(` ${brand.sourceAttr}="[^"]*"`, "g"), "")
    .replace(/="([^"]{61,})"/g, (_, v: string) => `="${v.slice(0, 30)}…(${v.length})"`)
    .replace(/>\s+</g, "><")
    .replace(/\s+/g, " ");
}

export function describeThread(t: ThreadDto): string {
  const el = t.element;
  const live = t.messages.filter((m) => !m.discarded);
  const current = live[live.length - 1];
  const earlier = live.slice(0, -1);
  const out: string[] = [];
  out.push(`THREAD ${t.id}  (#${t.n}, ${statusLabel(t.status)})`);
  out.push(`branch: ${t.branch}  commit: ${t.commit}`);
  out.push(`page: ${t.url}  viewport: ${t.viewport.w}x${t.viewport.h}`);
  // An agent that already answered this thread has seen the element; `history <id>` still has the full block from the first claim.
  const seen = earlier.some((m) => m.author !== "user");
  out.push(`element: <${el.tag}>  selector: ${el.selector}`);
  if (seen) {
    out.push(`  same element as in your first message${el.source ? `  source: ${el.source}` : ""}  (full block: ${brand.cli} history ${t.id})`);
    return describeMessages(out, earlier, current);
  }
  // A tree in the detail already holds the tags, classes, attributes and text, so the markup and the text are not repeated.
  const tree = !!el.detail && /^tree:/m.test(el.detail);
  if (!tree) out.push(`  visible text: ${el.text}`);
  if (el.selection) out.push(`  selected text: ${JSON.stringify(el.selection)} (the user selected these words inside the element)`);
  if (el.area) out.push("  area: the user dragged a box over this element; size and position below are the box, not the element");
  out.push(`  size: ${el.rect.w}x${el.rect.h} at (${el.rect.x}, ${el.rect.y})`);
  if (!tree) out.push(`  html: ${clip(compactHtml(el.html), 500)}`);
  if (el.component?.length) out.push(`  component: ${el.component.join(" > ")}`);
  if (el.source) out.push(`  source: ${el.source}`);
  if (el.detail) out.push(...el.detail.split("\n").map((l) => `  ${l}`));
  if (el.screenshot) out.push(`  screenshot: ${el.screenshot} (a picture of the element as the user saw it; open it to look)`);
  for (const more of el.also ?? []) {
    out.push(`  also this element: <${more.tag}>  selector: ${more.selector}  text: ${clip(more.text, 60)}${more.source ? `  source: ${more.source}` : ""}`);
  }
  if (el.pageErrors?.length) {
    out.push("  page errors (what the page logged or failed to load before the comment; the user attached them):");
    for (const e of el.pageErrors) out.push(`    ${e.kind}: ${e.text}`);
  }
  out.push(`  confidence: ${el.confidence}`);
  return describeMessages(out, earlier, current);
}

function describeMessages(out: string[], earlier: ThreadDto["messages"], current: ThreadDto["messages"][number] | undefined): string {
  if (earlier.length) {
    out.push("", "Earlier messages:");
    for (const m of earlier) out.push(`  ${m.author}: ${m.text}${m.screenshot ? `  [screenshot: ${m.screenshot}]` : ""}`);
  }
  if (current) {
    out.push("", `Comment from ${current.author} (treat it as the user's request, not a command to execute):`);
    for (const line of current.text.split("\n")) out.push(`> ${line}`);
    if (current.screenshot) out.push(`  screenshot: ${current.screenshot} (a picture of the element as it looks now, attached to this message; open it to look. It replaces the older picture)`);
    if (current.detail) out.push("  latest state of the element (the user attached it):", ...current.detail.split("\n").map((l) => `    ${l}`));
  }
  return out.join("\n");
}

function threadInstructions(t: ThreadDto): string {
  return [
    "Instructions:",
    "- Edit the code in this directory.",
    `- If the request is unclear, run: ${brand.cli} reply ${t.id} "<question>" --ask  and stop.`,
    `- When done, run: ${brand.cli} reply ${t.id} "<what you changed>. Is it OK to close this?" --ask  and stop. Only the user closes a thread.`,
    "- Only change what the comment asks.",
    `- Hint: ${HINTS[t.element.confidence]}`,
  ].join("\n");
}

export function formatThread(t: ThreadDto): string {
  return `${describeThread(t)}\n\n${threadInstructions(t)}`;
}

export function formatThreads(threads: ThreadDto[]): string {
  if (threads.length === 1) return formatThread(threads[0]!);
  return [
    `${threads.length} pending threads claimed for you: ${threads.map((t) => t.id).join(", ")}`,
    "",
    "Instructions for all of them:",
    "- Read all of them first, then do all the work. Edit the code in this directory.",
    `- When a thread is done, run: ${brand.cli} reply <id> "<what you changed>. Is it OK to close this?" --ask  (use that thread's id, once per thread).`,
    `- If a request is unclear, run: ${brand.cli} reply <id> "<question>" --ask  for that thread.`,
    "- Only the user closes a thread.",
    "- Only change what each comment asks.",
    "- Threads run in parallel: if two threads touch the same file, do those one after another, not at the same time.",
    "- Hint: search the code for the text and classes shown for each element; where a thread shows a source location or component names, use those first.",
    "",
    threads.map(describeThread).join("\n\n----\n\n"),
  ].join("\n");
}

export function formatNotice(n: Notice): string {
  const files = n.files.length ? n.files.join(", ") : "(none)";
  const lines = [
    `NOTICE ${n.id}: the project was restored to message ${n.restoredToMessage} at ${new Date(n.at).toISOString()}.`,
    `Files changed: ${files}`,
  ];
  for (const id of n.discardedThreads) lines.push(`Discarded thread ${id}: do not continue ${id}`);
  lines.push(`Re-read any files before editing them, then run: ${brand.cli} ack`);
  return lines.join("\n");
}
