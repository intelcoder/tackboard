import { test } from "node:test";
import assert from "node:assert/strict";
import { statusLabel } from "@app/shared";
import type { ThreadDto } from "@app/shared";
import { badgeCount, badgeLabel, bannerFor, clampToViewport, diffForEvents, errorText, isSubmitKey, restoreDisabledReason, visibleThreads } from "../src/panel_logic.ts";
import { parseHTML } from "linkedom";
import { createH } from "../src/dom.ts";
import { notificationState, permissionBanner } from "../src/notifications.ts";
import { ApiError } from "../src/api.ts";

function thread(n: number, extra: Partial<ThreadDto> = {}): ThreadDto {
  return {
    id: `t${n}`, n, branch: "main", commit: "abc", url: "http://x/", viewport: { w: 800, h: 600 },
    element: { selector: "#a", tag: "div", text: "", html: "", rect: { x: 0, y: 0, w: 0, h: 0 }, confidence: "text" },
    status: "pending", openedBy: "user", unread: false, discarded: false, claimStale: false,
    messages: [{ id: "m1", author: "user", text: "hi", at: 1, discarded: false }],
    ...extra,
  };
}

test("visibleThreads splits open and resolved", () => {
  const list = [thread(1), thread(2, { status: "resolved" }), thread(3, { status: "waiting" }), thread(4, { status: "received" })];
  assert.deepEqual(visibleThreads(list, "open").map((t) => t.n), [1, 3, 4]);
  assert.deepEqual(visibleThreads(list, "resolved").map((t) => t.n), [2]);
});

test("badgeCount counts waiting and unread threads once each", () => {
  const list = [
    thread(1, { status: "waiting", unread: true }),
    thread(2, { status: "waiting" }),
    thread(3, { unread: true }),
    thread(4),
    thread(5, { status: "received" }),
  ];
  assert.equal(badgeCount(list), 3);
  assert.equal(badgeCount([]), 0);
  assert.ok(badgeLabel(3).includes(statusLabel("waiting")));
  assert.equal(badgeLabel(0), "Comments");
});

test("badgeCount ignores discarded", () => {
  const list = [thread(1, { status: "waiting", discarded: true }), thread(2, { unread: true, discarded: true }), thread(3, { unread: true })];
  assert.equal(badgeCount(list), 1);
  assert.deepEqual(visibleThreads(list, "open").map((t) => t.n), [3]);
});

test("clampToViewport keeps the panel fully inside, including after a smaller viewport", () => {
  const panel = { x: 700, y: 500, w: 320, h: 400 };
  assert.deepEqual(clampToViewport(panel, { w: 1024, h: 900 }), { x: 700, y: 500 });
  assert.deepEqual(clampToViewport(panel, { w: 800, h: 600 }), { x: 480, y: 200 });
  assert.deepEqual(clampToViewport({ x: -50, y: -9, w: 320, h: 400 }, { w: 800, h: 600 }), { x: 0, y: 0 });
  assert.deepEqual(clampToViewport({ x: 10, y: 10, w: 320, h: 400 }, { w: 200, h: 200 }), { x: 0, y: 0 }, "bigger than the viewport pins to the corner");
});

test("clamp keeps the panel clear of the pill", () => {
  const pill = { x: 106, y: 746, w: 200, h: 50 };
  const view = { w: 320, h: 800 };
  const clear = (b: { x: number; y: number; w: number; h: number }, r: { x: number; y: number; maxHeight?: number }) => {
    const bottom = r.y + Math.min(b.h, r.maxHeight ?? b.h);
    const side = b.x + b.w <= pill.x || b.x >= pill.x + pill.w;
    return side || bottom <= pill.y;
  };
  // dragged to the bottom right, then the window shrank: the panel moves up above the pill
  const low = { x: 200, y: 700, w: 292, h: 400 - 100 };
  const moved = clampToViewport(low, view, pill);
  assert.ok(clear(low, moved), JSON.stringify(moved));
  assert.equal(moved.y, pill.y - 8 - low.h);
  assert.equal(moved.maxHeight, undefined);
  // too tall to fit above the pill: it sits at the top and gets a smaller height
  const tall = { x: 14, y: 100, w: 292, h: 760 };
  const squeezed = clampToViewport(tall, view, pill);
  assert.equal(squeezed.y, 0);
  assert.equal(squeezed.maxHeight, pill.y - 8);
  // beside the pill, or already above it, nothing changes
  assert.deepEqual(clampToViewport({ x: 0, y: 700, w: 100, h: 100 }, view, pill), { x: 0, y: 700 });
  assert.deepEqual(clampToViewport({ x: 14, y: 100, w: 292, h: 300 }, view, pill), { x: 14, y: 100 });
});

test("bannerFor maps granted, default, dismissed, denied and unsupported", () => {
  assert.equal(bannerFor("default", false), "ask");
  assert.equal(bannerFor("default", true), "link");
  assert.equal(bannerFor("denied", false), "blocked");
  assert.equal(bannerFor("granted", false), null);
  assert.equal(bannerFor("unsupported", false), null);
});

test("denied and not dismissed shows blocked", () => {
  assert.equal(bannerFor("denied", false), "blocked");
});

test("denied and dismissed shows nothing", () => {
  assert.equal(bannerFor("denied", true), null);
});

test("the blocked banner has a Dismiss button that calls onDismiss", () => {
  const h = createH(parseHTML("<html><body></body></html>").document as unknown as Document);
  const calls: string[] = [];
  const banner = permissionBanner(h, {
    state: "denied", dismissed: false, onAllow() {}, onNotNow() {}, onAskAgain() {}, onDismiss: () => calls.push("dismiss"),
  })!;
  const button = [...banner.querySelectorAll("button")].find((b) => b.textContent === "Dismiss") as HTMLElement;
  assert.ok(button, "a Dismiss button");
  button.click();
  assert.deepEqual(calls, ["dismiss"]);
  const gone = permissionBanner(h, {
    state: "denied", dismissed: true, onAllow() {}, onNotNow() {}, onAskAgain() {}, onDismiss() {},
  });
  assert.equal(gone, null);
});

test("diffForEvents reports a new agent message once", () => {
  const before = [thread(1, { status: "received", agent: "claude" })];
  const after = [
    thread(1, {
      status: "received", agent: "claude",
      messages: [
        { id: "m1", author: "user", text: "hi", at: 1, discarded: false },
        { id: "m2", author: "claude", text: "done", at: 2, discarded: false },
      ],
    }),
  ];
  const first = diffForEvents(before, after);
  assert.deepEqual(first.map((e) => e.kind), ["reply"]);
  assert.equal((first[0] as any).text, "done");
  assert.deepEqual(diffForEvents(after, after), [], "the same list again reports nothing");

  const claimed = diffForEvents([thread(1)], [thread(1, { status: "received", agent: "claude" })]);
  assert.deepEqual(claimed.map((e) => e.kind), ["received"]);
  const resolved = diffForEvents([thread(1, { status: "received" })], [thread(1, { status: "resolved" })]);
  assert.deepEqual(resolved.map((e) => e.kind), ["resolved"]);
  assert.deepEqual(diffForEvents([thread(1, { status: "received" })], [thread(1, { status: "pending" })]), [], "released is not announced");
});

test("notificationState maps Notification.permission and returns \"unsupported\" when absent", () => {
  assert.equal(notificationState({ permission: "granted" }), "granted");
  assert.equal(notificationState({ permission: "default" }), "default");
  assert.equal(notificationState({ permission: "denied" }), "denied");
  assert.equal(notificationState(undefined), "unsupported");
  assert.equal(restoreDisabledReason({ restoreBlocked: "thread #2 is claimed by claude" }), "thread #2 is claimed by claude");
  assert.equal(restoreDisabledReason({ restoreBlocked: null }), null);
  assert.equal(errorText(new ApiError("too_large", "text exceeds 100 KB", 413)), "text exceeds 100 KB");
  assert.equal(errorText(new TypeError("fetch failed")), "Cannot reach the daemon");
});

test("isSubmitKey: Enter sends, Shift+Enter does not, Ctrl or Cmd plus Enter sends, composition never sends", () => {
  const key = (extra: object) => ({ key: "Enter", shiftKey: false, ctrlKey: false, metaKey: false, isComposing: false, keyCode: 13, ...extra });
  assert.equal(isSubmitKey(key({})), true);
  assert.equal(isSubmitKey(key({ shiftKey: true })), false);
  assert.equal(isSubmitKey(key({ ctrlKey: true })), true);
  assert.equal(isSubmitKey(key({ metaKey: true })), true);
  assert.equal(isSubmitKey(key({ key: "a" })), false);
  assert.equal(isSubmitKey(key({ isComposing: true })), false);
  assert.equal(isSubmitKey(key({ keyCode: 229 })), false);
  assert.equal(isSubmitKey(key({ ctrlKey: true, isComposing: true })), false);
});
