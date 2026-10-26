import { test } from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { statusLabel } from "@app/shared";
import type { MessageDto, ThreadDto, ThreadStatus } from "@app/shared";
import { createH } from "../src/dom.ts";
import { toastText } from "../src/toast.ts";
import {
  detachedList, messageView, queuedItem, restoreConfirm, statusChip, threadItem,
} from "../src/thread_view.ts";
import type { ThreadItemOptions } from "../src/thread_view.ts";

const parsed = parseHTML(`<html><body><button id="here">Go</button></body></html>`);
const doc = parsed.document as unknown as Document;
const h = createH(doc);

function message(id: string, author: string, text: string, extra: Partial<MessageDto> = {}): MessageDto {
  return { id, author, text, at: 1, discarded: false, ...extra };
}

function thread(n: number, extra: Partial<ThreadDto> = {}): ThreadDto {
  return {
    id: `t${n}`, n, branch: "main", commit: "abc", url: "http://x/", viewport: { w: 800, h: 600 },
    element: { selector: "#here", tag: "button", text: "Go", html: "", rect: { x: 0, y: 0, w: 0, h: 0 }, confidence: "text" },
    status: "pending", openedBy: "user", unread: false, discarded: false, claimStale: false,
    messages: [message("m1", "user", "hi")],
    ...extra,
  };
}

function options(extra: Partial<ThreadItemOptions> = {}): ThreadItemOptions {
  const nothing = () => {};
  return {
    open: true, label: "button#here", missing: false, history: false, draft: "",
    onToggle: nothing, onDraft: nothing, onReply: nothing, onResolve: nothing, onReopen: nothing,
    onRelease: nothing, onRestore: nothing, confirm: null, queued: [],
    ...extra,
  };
}

test("message text with img onerror becomes a text node", () => {
  const evil = "<img src=x onerror=alert(1)>";
  const evil2 = "</script><script>alert(2)</script>";
  const one = messageView(h, message("m1", "user", evil), false);
  const two = messageView(h, message("m2", "claude", evil2), false);
  const whole = threadItem(h, thread(1, { messages: [message("m1", "user", evil), message("m2", "claude", evil2)] }), options());
  for (const el of [one, two, whole]) {
    assert.equal(el.querySelector("img"), null);
    assert.equal(el.querySelector("script"), null);
  }
  assert.equal(one.querySelector(".text")!.textContent, evil);
  assert.equal(two.querySelector(".text")!.textContent, evil2);
  const texts = [...whole.querySelectorAll(".tb-msg .text")].map((n) => n.textContent);
  assert.deepEqual(texts, [evil, evil2]);
});

test("chip, ThreadItem, toast and badge text all come from statusLabel", async () => {
  const { badgeLabel } = await import("../src/panel_logic.ts");
  const all: (ThreadStatus | "discarded")[] = ["pending", "received", "waiting", "resolved", "discarded"];
  for (const s of all) assert.equal(statusChip(h, s).textContent, statusLabel(s));
  for (const s of ["pending", "received", "waiting", "resolved"] as ThreadStatus[]) {
    const row = threadItem(h, thread(1, { status: s }), options({ open: false }));
    assert.equal(row.querySelector(".tb-chip")!.textContent, statusLabel(s));
  }
  assert.ok(toastText({ kind: "received", threadId: "t1", n: 1, agent: "claude" }).includes(statusLabel("received")));
  assert.ok(toastText({ kind: "resolved", threadId: "t1", n: 1 }).includes(statusLabel("resolved")));
  assert.ok(badgeLabel(2).includes(statusLabel("waiting")));
});

test("RestoreConfirm is disabled with the reason", () => {
  const calls: string[] = [];
  const blocked = restoreConfirm(h, {
    number: 3, blocked: "thread #2 is claimed by claude", onRewind: () => calls.push("rewind"), onKeep: () => calls.push("keep"),
  });
  assert.ok(blocked.textContent!.includes("Rewind the project to message 3?"));
  assert.ok(blocked.textContent!.includes("thread #2 is claimed by claude"));
  const rewind = blocked.querySelector("button.danger")!;
  assert.ok(rewind.hasAttribute("disabled"));
  (rewind as HTMLElement).click();
  (blocked.querySelector("button[data-keep]") as HTMLElement).click();
  assert.deepEqual(calls, ["keep"], "a disabled Rewind does nothing");

  const free = restoreConfirm(h, { number: 3, blocked: null, onRewind: () => calls.push("rewind"), onKeep: () => {} });
  assert.ok(!free.querySelector("button.danger")!.hasAttribute("disabled"));
  (free.querySelector("button.danger") as HTMLElement).click();
  assert.deepEqual(calls, ["keep", "rewind"]);
});

test("a RestorePoint renders after each message with a checkpoint only", () => {
  const t = thread(1, {
    messages: [
      message("m1", "user", "one"),
      message("m2", "claude", "two", { checkpointId: "abcdef1234" }),
      message("m3", "user", "three"),
      message("m4", "claude", "four", { checkpointId: "9876543210" }),
    ],
  });
  const el = threadItem(h, t, options());
  const kids = [...el.querySelector(".tb-convo")!.children].map((c) => (c.classList.contains("tb-restore") ? "restore" : "msg"));
  assert.deepEqual(kids, ["msg", "msg", "restore", "msg", "msg", "restore"]);
  const asked: string[] = [];
  const again = threadItem(h, t, options({ onRestore: (id) => asked.push(id) }));
  (again.querySelectorAll(".tb-restore button")[1] as HTMLElement).click();
  assert.deepEqual(asked, ["m4"]);
});

test("discarded messages are hidden outside History and shown with the discarded chip inside it", () => {
  const t = thread(1, {
    messages: [
      message("m1", "user", "kept"),
      message("m2", "claude", "gone", { discarded: true, checkpointId: "abc1234" }),
    ],
  });
  const normal = threadItem(h, t, options());
  assert.ok(!normal.textContent!.includes("gone"));
  assert.equal(normal.querySelector(".tb-discarded"), null);

  const history = threadItem(h, t, options({ history: true }));
  const shown = history.querySelector(".tb-discarded")!;
  assert.ok(shown.textContent!.includes("gone"));
  assert.equal(shown.querySelector(".tb-chip")!.textContent, statusLabel("discarded"));
  assert.equal(history.querySelector(".tb-reply"), null, "history is read only");
  assert.equal(history.querySelector(".tb-restore button"), null, "no restore button in history");
});

test("the DetachedList shows a thread whose element is missing", () => {
  const lost = thread(2, { element: { ...thread(2).element, selector: "#gone", tag: "section", text: "nothing like this" } });
  const list = detachedList(h, [lost], (t) => threadItem(h, t, options({ open: false, missing: true, label: "section#gone" })));
  assert.ok(list.textContent!.includes("element missing"));
  assert.equal(list.querySelectorAll(".tb-thread").length, 1);
});

test("the Release button shows only on received threads", () => {
  const names = (t: ThreadDto) => [...threadItem(h, t, options()).querySelectorAll("button")].map((b) => b.textContent);
  assert.ok(names(thread(1, { status: "received", agent: "claude" })).includes("Release"));
  for (const s of ["pending", "waiting", "resolved"] as ThreadStatus[]) {
    assert.ok(!names(thread(1, { status: s })).includes("Release"), s);
  }
  assert.ok(names(thread(1, { status: "resolved" })).includes("Reopen"));
  assert.ok(!names(thread(1, { status: "pending" })).includes("Reopen"));
  const resolveButton = [...threadItem(h, thread(1, { status: "waiting" }), options()).querySelectorAll("button")].find((b) => b.textContent === "Resolve")!;
  assert.ok(!resolveButton.hasAttribute("disabled"), "the user can always resolve");
  const stale = threadItem(h, thread(1, { status: "received", claimStale: true }), options());
  assert.ok(stale.querySelector(".tb-hint")!.textContent!.length > 0, "a stale claim shows a hint");
});

function press(box: Element, init: object) {
  const ev = Object.assign(new (parsed.window as any).Event("keydown", { bubbles: true, cancelable: true }), { key: "Enter", ...init });
  box.dispatchEvent(ev);
  return ev as Event;
}

test("Enter in the reply box sends and empties it; Shift+Enter and composition do not", () => {
  const sent: string[] = [];
  const el = threadItem(h, thread(1), options({ onReply: (text) => sent.push(text) }));
  const box = el.querySelector("textarea") as HTMLTextAreaElement;
  box.value = "  hello  ";
  assert.equal(press(box, { shiftKey: true }).defaultPrevented, false);
  assert.equal(press(box, { isComposing: true }).defaultPrevented, false);
  assert.equal(press(box, { keyCode: 229 }).defaultPrevented, false);
  assert.deepEqual(sent, []);
  assert.equal(press(box, {}).defaultPrevented, true);
  assert.deepEqual(sent, ["hello"]);
  assert.equal(box.value, "");
  box.value = "again";
  press(box, { ctrlKey: true });
  assert.deepEqual(sent, ["hello", "again"]);
});

test("queued items show their status, and only Not sent has Retry and Remove", () => {
  const calls: string[] = [];
  const view = (status: string, failed: boolean) =>
    queuedItem(h, { label: null, text: "mine", status, failed, onRetry: () => calls.push("retry"), onRemove: () => calls.push("remove") });
  const sending = view("Sending…", false);
  assert.ok(sending.textContent!.includes("mine"));
  assert.ok(sending.textContent!.includes("Sending…"));
  assert.equal(sending.querySelectorAll("button").length, 0);
  const failed = view("Not sent: boom", true);
  const names = [...failed.querySelectorAll("button")].map((b) => b.textContent);
  assert.deepEqual(names, ["Retry", "Remove"]);
  (failed.querySelectorAll("button")[0] as HTMLElement).click();
  (failed.querySelectorAll("button")[1] as HTMLElement).click();
  assert.deepEqual(calls, ["retry", "remove"]);
  const comment = queuedItem(h, { label: "button#cta", text: "x", status: "Sending…", failed: false, onRetry() {}, onRemove() {} });
  assert.ok(comment.querySelector(".tb-target")!.textContent === "button#cta");
});

test("a queued reply shows at the end of its thread and as text only", () => {
  const evil = "<img src=x onerror=alert(1)>";
  const el = threadItem(h, thread(1), options({
    queued: [{ label: null, text: evil, status: "Sending…", failed: false, onRetry() {}, onRemove() {} }],
  }));
  assert.equal(el.querySelector("img"), null);
  assert.equal(el.querySelector(".tb-convo")!.lastElementChild!.classList.contains("tb-queued"), true);
  assert.equal(el.querySelectorAll(".tb-msg").length, 1, "a queued item is not a real message");
});
