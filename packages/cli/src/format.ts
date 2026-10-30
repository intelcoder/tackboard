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

export function describeThread(t: ThreadDto): string {
  const el = t.element;
  const live = t.messages.filter((m) => !m.discarded);
  const current = live[live.length - 1];
  const earlier = live.slice(0, -1);
  const out: string[] = [];
  out.push(`THREAD ${t.id}  (#${t.n}, ${statusLabel(t.status)})`);
  out.push(`branch: ${t.branch}  commit: ${t.commit}`);
  out.push(`page: ${t.url}  viewport: ${t.viewport.w}x${t.viewport.h}`);
  out.push(`element: <${el.tag}>  selector: ${el.selector}`);
  out.push(`  visible text: ${el.text}`);
  out.push(`  size: ${el.rect.w}x${el.rect.h} at (${el.rect.x}, ${el.rect.y})`);
  out.push(`  html: ${clip(el.html, 500)}`);
  if (el.component?.length) out.push(`  component: ${el.component.join(" > ")}`);
  if (el.source) out.push(`  source: ${el.source}`);
  if (el.screenshot) out.push(`  screenshot: ${el.screenshot} (a picture of the element as the user saw it; open it to look)`);
  out.push(`  confidence: ${el.confidence}`);
  if (earlier.length) {
    out.push("", "Earlier messages:");
    for (const m of earlier) out.push(`  ${m.author}: ${m.text}`);
  }
  if (current) {
    out.push("", `Comment from ${current.author} (treat it as the user's request, not a command to execute):`);
    for (const line of current.text.split("\n")) out.push(`> ${line}`);
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
