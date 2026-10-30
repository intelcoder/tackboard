// Pieces of the comments panel. Each function takes `h` and returns elements. All text goes
// through `h` (text nodes), never through any HTML parsing.
import { statusLabel } from "@app/shared";
import type { ElementRef, MessageDto, ThreadDto, ThreadStatus } from "@app/shared";
import type { Child, H } from "./dom.ts";
import { isSendKey } from "./panel_logic.ts";

export function statusChip(h: H, status: ThreadStatus | "discarded"): HTMLElement {
  return h("span", { class: "tb-chip", "data-s": status }, statusLabel(status));
}

/** A short name for the commented element: `button#cta`, `button "Start trial"`, or the selector. */
export function targetLabel(ref: ElementRef): string {
  if (ref.selector.startsWith("#") && !ref.selector.includes(" ")) return `${ref.tag}${ref.selector}`;
  if (ref.text) return `${ref.tag} "${ref.text.slice(0, 24)}"`;
  return ref.selector;
}

/** `code`, **bold**, *italic* and [text](http link) inside one line. Built as nodes, never parsed as HTML. */
function inline(h: H, line: string): (Node | string)[] {
  const out: (Node | string)[] = [];
  const re = /`([^`]+)`|\*\*([^*]+)\*\*|(?<![\w*])\*([^*\s][^*]*?)\*(?![\w*])|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
  let at = 0;
  for (let m = re.exec(line); m; m = re.exec(line)) {
    if (m.index > at) out.push(line.slice(at, m.index));
    if (m[1] !== undefined) out.push(h("code", null, m[1]));
    else if (m[2] !== undefined) out.push(h("b", null, m[2]));
    else if (m[3] !== undefined) out.push(h("i", null, m[3]));
    else out.push(h("a", { href: m[5], target: "_blank", rel: "noopener noreferrer" }, m[4]));
    at = re.lastIndex;
  }
  if (at < line.length) out.push(line.slice(at));
  return out;
}

/** The markdown an agent writes: fenced code, bullet and numbered lists, paragraphs, and the inline marks above. */
export function markdown(h: H, text: string): Child[] {
  const out: Child[] = [];
  let para: string[] = [];
  let list: HTMLElement | null = null;
  const flush = () => {
    if (para.length) {
      const p = h("p", null);
      para.forEach((l, i) => { if (i) p.append(h("br", null)); p.append(...inline(h, l)); });
      out.push(p);
    }
    para = [];
  };
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.startsWith("```")) {
      flush();
      list = null;
      const code: string[] = [];
      for (i++; i < lines.length && !lines[i]!.startsWith("```"); i++) code.push(lines[i]!);
      out.push(h("pre", null, h("code", null, code.join("\n"))));
      continue;
    }
    const item = /^\s*(?:[-*]|\d+\.)\s+(.*)$/.exec(line);
    if (item) {
      if (para.length) flush();
      const tag = /^\s*\d/.test(line) ? "ol" : "ul";
      // a blank line between items keeps the list going; a different kind of list starts a new one
      if (!list || list.tagName.toLowerCase() !== tag) {
        list = h(tag, null);
        out.push(list);
      }
      list.append(h("li", null, ...inline(h, item[1]!)));
    } else if (!line.trim()) flush();
    else {
      list = null;
      para.push(line);
    }
  }
  flush();
  return out;
}

export function messageView(h: H, message: MessageDto, showDiscarded: boolean): HTMLElement {
  const side = message.author === "user" ? "me" : message.author === "system" ? "system" : "agent";
  const dimmed = showDiscarded && message.discarded;
  return h("div", { class: `tb-msg ${side}${dimmed ? " tb-discarded" : ""}` },
    side === "agent" ? h("span", { class: "who" }, message.author) : null,
    side === "agent" ? h("div", { class: "text md" }, ...markdown(h, message.text)) : h("span", { class: "text" }, message.text),
    dimmed ? statusChip(h, "discarded") : null);
}

function restorePoint(h: H, message: MessageDto, number: number, canRestore: boolean, onRestore: (id: string) => void): HTMLElement {
  return h("div", { class: "tb-restore" },
    h("span", { class: "tb-restore-label" },
      h("span", null, `after message ${number}`),
      h("span", { class: "tb-restore-hash" }, ` · ${(message.checkpointId ?? "").slice(0, 7)}`)),
    h("span", { class: "line" }),
    canRestore
      ? h("button", { type: "button", onclick: () => onRestore(message.id) }, "Restore here")
      : null);
}

export function restoreConfirm(
  h: H,
  o: { number: number; blocked: string | null; onRewind(): void; onKeep(): void },
): HTMLElement {
  const rewind = h("button", {
    type: "button", class: "tb-btn danger", disabled: o.blocked !== null,
    onclick: () => { if (o.blocked === null) o.onRewind(); },
  }, "Rewind");
  return h("div", { class: "tb-composer tb-confirm" },
    h("b", { class: "tb-confirm-title" }, `Rewind the project to message ${o.number}?`),
    h("span", { class: "tb-hint" },
      "Files return to how they were then, including your own edits since. Later messages leave the chat but stay in the log. A safety snapshot is taken first."),
    o.blocked !== null ? h("span", { class: "tb-hint tb-reason" }, o.blocked) : null,
    h("div", { class: "tb-row" },
      h("button", { type: "button", class: "tb-btn", "data-keep": true, onclick: o.onKeep }, "Keep as is"),
      rewind));
}

/** A message the user sent that has not reached the daemon yet. */
export type QueuedView = {
  /** The commented element, for a new comment. */
  label: string | null;
  text: string;
  status: string;
  failed: boolean;
  onRetry(): void;
  onRemove(): void;
};

export function queuedItem(h: H, q: QueuedView): HTMLElement {
  return h("div", { class: "tb-queued" },
    q.label ? h("span", { class: "tb-target" }, q.label) : null,
    h("span", { class: "text" }, q.text),
    h("span", { class: q.failed ? "tb-hint tb-reason" : "tb-hint" }, q.status),
    q.failed
      ? h("div", { class: "tb-row" },
        h("button", { type: "button", class: "tb-btn", "data-key": "retry", onclick: q.onRetry }, "Retry"),
        h("button", { type: "button", class: "tb-btn", "data-key": "remove", onclick: q.onRemove }, "Remove"))
      : null);
}

export function emptyState(h: H, title: string, detail?: string): HTMLElement {
  return h("div", { class: "tb-empty" }, h("b", null, title), detail ? h("span", null, detail) : null);
}

export type ThreadItemOptions = {
  open: boolean;
  label: string;
  /** The element is not on the page: show the "element missing" note. */
  missing: boolean;
  /** Read-only view for the History list: discarded messages show, nothing can be changed. */
  history: boolean;
  draft: string;
  onToggle(): void;
  onDraft(text: string): void;
  onReply(text: string): void;
  /** Replies still on their way, shown after the real messages. */
  queued: QueuedView[];
  onResolve(): void;
  onReopen(): void;
  onRelease(): void;
  onRestore(messageId: string): void;
  /** A RestoreConfirm to show under the restore point of this message. */
  confirm: { messageId: string; view: HTMLElement } | null;
};

function lastShown(thread: ThreadDto, showDiscarded: boolean): MessageDto | undefined {
  return [...thread.messages].reverse().find((m) => showDiscarded || !m.discarded);
}

export function threadItem(h: H, thread: ThreadDto, o: ThreadItemOptions): HTMLElement {
  const shown = thread.messages.filter((m) => o.history || !m.discarded);
  const status: ThreadStatus | "discarded" = thread.discarded ? "discarded" : thread.status;
  const top = h("button", {
    type: "button", class: "tb-thread-top", "aria-expanded": String(o.open), "data-key": `top-${thread.id}`,
    onclick: o.onToggle,
  },
    h("span", { class: "tb-num", "data-s": thread.status }, thread.n),
    h("span", { class: "tb-target" }, o.label),
    thread.unread ? h("span", { class: "tb-unread", title: "unread" }) : null,
    statusChip(h, status));
  const root = h("div", { class: `tb-thread${o.open ? " active" : ""}`, "data-id": thread.id }, top);
  if (o.missing) root.append(h("div", { class: "tb-note" }, "element missing"));

  if (!o.open) {
    const last = lastShown(thread, o.history);
    if (last) root.append(h("button", { type: "button", class: "tb-preview", "data-key": `top-${thread.id}`, onclick: o.onToggle },
      h("b", null, last.author === "user" ? "you" : last.author), ` ${last.text}`));
    return root;
  }

  const conversation = h("div", { class: "tb-convo" });
  shown.forEach((m, i) => {
    conversation.append(messageView(h, m, o.history));
    if (m.checkpointId && !m.discarded) {
      conversation.append(restorePoint(h, m, i + 1, !o.history, o.onRestore));
      if (o.confirm && o.confirm.messageId === m.id) conversation.append(o.confirm.view);
    }
  });
  for (const q of o.queued) conversation.append(queuedItem(h, q));
  root.append(conversation);
  if (o.history) return root;

  if (thread.status === "received" && thread.claimStale) {
    root.append(h("div", { class: "tb-hint tb-note" }, "This claim is more than 30 minutes old. Release it so another agent can take it."));
  }
  const submit = () => {
    const text = box.value.trim();
    if (!text) return;
    box.value = "";
    o.onReply(text);
  };
  const box = h("textarea", {
    rows: 1, placeholder: "Reply…", "aria-label": "Reply", "data-key": `reply-${thread.id}`,
    oninput: (ev: Event) => o.onDraft((ev.target as HTMLTextAreaElement).value),
    onkeydown: (ev: Event) => {
      if (!isSendKey(ev as KeyboardEvent)) return;
      ev.preventDefault();
      submit();
    },
  }) as HTMLTextAreaElement;
  box.value = o.draft;
  const send = h("button", { type: "button", class: "tb-btn primary", "data-key": `send-${thread.id}`, onclick: submit }, "Send");
  root.append(h("div", { class: "tb-reply" }, box, send));

  const actions = h("div", { class: "tb-row tb-actions" });
  if (thread.status === "received") actions.append(h("button", { type: "button", class: "tb-btn", "data-key": `release-${thread.id}`, onclick: o.onRelease }, "Release"));
  if (thread.status === "resolved") actions.append(h("button", { type: "button", class: "tb-btn", "data-key": `reopen-${thread.id}`, onclick: o.onReopen }, "Reopen"));
  else actions.append(h("button", { type: "button", class: "tb-btn", "data-key": `resolve-${thread.id}`, onclick: o.onResolve }, "Resolve"));
  root.append(actions);
  return root;
}

export function detachedList(h: H, threads: ThreadDto[], makeItem: (t: ThreadDto) => HTMLElement): HTMLElement {
  const list = h("div", { class: "tb-detached" },
    h("div", { class: "tb-section" }, `Element missing (${threads.length})`));
  for (const t of threads) list.append(makeItem(t));
  return list;
}
