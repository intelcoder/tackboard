// The comments panel: a floating window with the thread list, the comment box and History.
import { brand } from "@app/shared";
import type { ElementRef, ThreadDto } from "@app/shared";
import type { Api } from "./api.ts";
import type { H } from "./dom.ts";
import { createFinder } from "./element_ref.ts";
import { notificationState, permissionAsked, permissionBanner, rememberNotNow } from "./notifications.ts";
import { createSendQueue } from "./send_queue.ts";
import type { QueueItem } from "./send_queue.ts";
import { badgeCount, clampToViewport, errorText, isSendKey, restoreDisabledReason, visibleThreads } from "./panel_logic.ts";
import type { Tab } from "./panel_logic.ts";
import type { Store } from "./store.ts";
import { toastText } from "./toast.ts";
import { detachedList, emptyState, queuedItem, restoreConfirm, targetLabel, threadItem } from "./thread_view.ts";
import type { QueuedView } from "./thread_view.ts";

export type PanelOptions = {
  document: Document;
  window: Window;
  /** Where the panel element goes (inside the Shadow root). */
  layer: Element;
  h: H;
  store: Store;
  api: Api;
  viewport: () => { w: number; h: number };
  /** Ask the poller for fresh data now. */
  refresh(): void;
  showToast(text: string): void;
};

export type Panel = {
  /** Open the comment box for a picked element. */
  compose(ref: ElementRef, el: Element): void;
  /** Open a thread in the list. With `scroll`, also bring the element into view, outline it and pulse its pin. */
  openThread(id: string, scroll?: boolean): void;
  destroy(): void;
};

type ToSend =
  | { kind: "comment"; ref: ElementRef; url: string; viewport: { w: number; h: number }; text: string }
  | { kind: "reply"; threadId: string; text: string };

type CommentToSend = Extract<ToSend, { kind: "comment" }>;

const FLASH_MS = 1800;
const SAVED_KEY = `${brand.configGlobal}:notify-later`;
const BLOCKED_KEY = `${brand.configGlobal}:blocked-hint-hidden`;

function storageOf(win: Window): Storage | undefined {
  try {
    return win.localStorage;
  } catch {
    return undefined;
  }
}

export function createPanel(o: PanelOptions): Panel {
  const { document: doc, window: win, layer, h, store, api } = o;
  const finder = createFinder(doc, win, store);
  const storage = storageOf(win);

  // What only the panel cares about. Anything the pins or pill need lives in the store.
  let tab: Tab = "open";
  let showHistory = false;
  let historyOpenId: string | null = null;
  let composer: { ref: ElementRef } | null = null;
  let composerDraft = "";
  let confirming: { threadId: string; messageId: string } | null = null;
  let notice: string | null = null;
  let dismissed = permissionAsked(storage, SAVED_KEY);
  let blockedHidden = permissionAsked(storage, BLOCKED_KEY);
  let moved: { x: number; y: number } | null = null;
  const replyDrafts = new Map<string, string>();
  // Comments added to the batch. They live in the page only and are lost on reload.
  let drafts: { id: string; job: CommentToSend }[] = [];
  let draftNumber = 0;
  const timers = new Set<ReturnType<typeof setTimeout>>();

  const later = (fn: () => void, ms: number) => {
    const t = setTimeout(() => {
      timers.delete(t);
      fn();
    }, ms);
    timers.add(t);
  };

  const panel = h("div", { class: "tb-panel", role: "dialog", "aria-label": "Comments", hidden: true });
  const flashLayer = h("div", { class: "tb-flash-layer" });
  layer.append(panel, flashLayer);

  const saveThread = (t: ThreadDto) => {
    const s = store.get();
    const has = s.threads.some((x) => x.id === t.id);
    const threads = has ? s.threads.map((x) => (x.id === t.id ? t : x)) : [...s.threads, t];
    store.set({ threads, badge: badgeCount(threads) });
  };

  const goTo = (t: ThreadDto) => {
    tab = t.status === "resolved" ? "resolved" : "open";
    showHistory = false;
    composer = null;
    store.set({ activeThreadId: t.id, panelOpen: true, composing: false });
  };

  const markRead = (t: ThreadDto) => {
    if (!t.unread) return;
    api.markRead(t.id).then(saveThread, () => {});
  };

  // ---- scroll link: outline and pulse ----

  const flash = (el: Element) => {
    const box = h("div", { class: "tb-flash" });
    flashLayer.append(box);
    const place = () => {
      const r = el.getBoundingClientRect();
      Object.assign(box.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
    };
    place();
    win.addEventListener("scroll", place, true);
    later(() => {
      win.removeEventListener("scroll", place, true);
      box.remove();
    }, FLASH_MS);
  };

  const reducedMotion = (): boolean => {
    try {
      return win.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch {
      return false;
    }
  };

  const showElement = (el: Element) => {
    try {
      el.scrollIntoView({ block: "center", behavior: reducedMotion() ? "auto" : "smooth" });
    } catch {
      // not every environment can scroll
    }
    flash(el);
  };

  const openThread = (id: string, scroll = false) => {
    const t = store.get().threads.find((x) => x.id === id);
    if (!t) return;
    if (confirming && confirming.threadId !== id) confirming = null;
    goTo(t);
    markRead(t);
    if (!scroll) return;
    const el = finder.find(t);
    if (!el) return;
    showElement(el);
    store.set({ pulseThreadId: id });
    later(() => {
      if (store.get().pulseThreadId === id) store.set({ pulseThreadId: null });
    }, FLASH_MS);
  };

  const toggleThread = (t: ThreadDto) => {
    if (store.get().activeThreadId === t.id) {
      confirming = null;
      store.set({ activeThreadId: null });
    } else openThread(t.id, true);
  };

  // ---- actions ----

  const run = (call: () => Promise<ThreadDto>, after?: (t: ThreadDto) => void) => {
    notice = null;
    call().then(
      (t) => {
        saveThread(t);
        after?.(t);
        draw();
      },
      (e) => {
        notice = errorText(e);
        draw();
      },
    );
  };

  const deliver = async (job: ToSend, signal: AbortSignal) => {
    if (job.kind === "reply") {
      saveThread(await api.postMessage(job.threadId, { author: "user", text: job.text }, signal));
      tab = "open";
      return;
    }
    const t = await api.postThread({ element: job.ref, url: job.url, viewport: job.viewport, text: job.text }, signal);
    saveThread(t);
    tab = "open";
    store.set({ mode: "view", activeThreadId: t.id, panelOpen: true });
    o.refresh();
  };
  const sendQueue = createSendQueue<ToSend>({ send: deliver, onChange: () => draw() });

  const reply = (t: ThreadDto, text: string) => {
    replyDrafts.delete(t.id);
    sendQueue.add({ kind: "reply", threadId: t.id, text });
  };

  const queuedView = (item: QueueItem<ToSend>, label: string | null): QueuedView => ({
    label,
    text: item.job.text.length > 300 ? `${item.job.text.slice(0, 299)}…` : item.job.text,
    status: item.state === "failed" ? `Not sent: ${item.reason}` : sendQueue.beingSent(item) ? "Sending…" : "Waiting to retry",
    failed: item.state === "failed",
    onRetry: () => sendQueue.retry(item),
    onRemove: () => sendQueue.remove(item),
  });

  const rewind = (t: ThreadDto, messageId: string, number: number) => {
    notice = null;
    api.restore({ threadId: t.id, messageId }).then(
      () => {
        confirming = null;
        o.showToast(toastText({ kind: "restored", number }));
        o.refresh();
        draw();
      },
      (e) => {
        notice = errorText(e);
        draw();
      },
    );
  };

  const compose = (ref: ElementRef) => {
    composer = { ref };
    composerDraft = "";
    showHistory = false;
    store.set({ composing: true, panelOpen: true, activeThreadId: null });
  };

  const closeComposer = () => {
    composer = null;
    store.set({ composing: false });
  };

  const send = () => {
    const text = composerDraft.trim();
    if (!composer || !text) return;
    sendQueue.add({ kind: "comment", ref: composer.ref, url: win.location.href, viewport: o.viewport(), text });
    closeComposer();
  };

  const showDraftCount = () => {
    const badge = (panel.getRootNode() as ShadowRoot).querySelector?.(".tb-modes .draft-count");
    if (!badge) return;
    badge.textContent = drafts.length ? String(drafts.length) : "";
    if (drafts.length) badge.removeAttribute("hidden");
    else badge.setAttribute("hidden", "");
  };

  const addDraft = () => {
    const text = composerDraft.trim();
    if (!composer || !text) return;
    drafts.push({ id: `draft-${++draftNumber}`, job: { kind: "comment", ref: composer.ref, url: win.location.href, viewport: o.viewport(), text } });
    showDraftCount();
    o.showToast(`Draft added (${drafts.length})`);
    closeComposer();
  };

  const sendAll = () => {
    const all = drafts;
    drafts = [];
    showDraftCount();
    for (const d of all) sendQueue.add(d.job);
  };

  const draftsBlock = (): HTMLElement =>
    h("div", { class: "tb-queue tb-drafts", "data-key": "drafts" },
      h("div", { class: "tb-section tb-row" },
        h("b", { class: "tb-drafts-title" }, `Drafts (${drafts.length})`),
        h("button", { type: "button", class: "tb-btn primary", "data-key": "send-all", onclick: sendAll }, `Send all (${drafts.length})`)),
      ...drafts.map((d) => {
        return h("div", { class: "tb-queued" },
          h("div", { class: "tb-draft-top" },
            h("button", {
              type: "button", class: "tb-thread-top", "data-key": "draft-target",
              onclick: () => {
                const el = finder.find({ id: d.id, url: d.job.url, element: d.job.ref });
                if (el) showElement(el);
              },
            }, h("span", { class: "tb-target" }, targetLabel(d.job.ref))),
            h("button", { type: "button", class: "tb-btn", "data-key": "remove-draft", onclick: () => { drafts = drafts.filter((x) => x !== d); showDraftCount(); draw(); } }, "Remove")),
          h("span", { class: "text" }, d.job.text.length > 300 ? `${d.job.text.slice(0, 299)}…` : d.job.text));
      }));

  // ---- drawing ----

  const header = (): HTMLElement => {
    const s = store.get();
    const agent = s.agent;
    return h("div", { class: "tb-head" },
      h("div", { class: "tb-title" },
        h("b", null, h("span", { class: "tb-grip", "aria-hidden": "true" }, "⋮⋮"), " Comments"),
        s.branch ? h("span", { class: "tb-branch", title: s.branch }, s.branch) : null),
      h("span", { class: "tb-head-right" },
        h("span", { class: `tb-agent${agent.online ? "" : " off"}`, title: agent.online ? "Agent is connected" : "Agent is not connected" },
          h("span", { class: "dot" }), agent.name ?? "no agent"),
        h("button", { type: "button", class: "tb-x", "aria-label": "Close comments", title: "Close", "data-key": "close", onclick: close }, "✕")));
  };

  const close = () => {
    composer = null;
    confirming = null;
    store.set({ panelOpen: false, composing: false });
  };

  const tabs = (): HTMLElement => {
    const all = store.get().threads;
    const tabButton = (name: Tab, label: string) =>
      h("button", {
        type: "button", class: tab === name ? "on" : null, "aria-pressed": String(tab === name), "data-key": `tab-${name}`,
        onclick: () => {
          tab = name;
          confirming = null;
          store.set({ activeThreadId: null });
        },
      }, label, " ", h("i", null, visibleThreads(all, name).length));
    return h("div", { class: "tb-tabs" }, tabButton("open", "Open"), tabButton("resolved", "Resolved"));
  };

  const composerView = (): HTMLElement => {
    const s = store.get();
    const box = h("textarea", {
      placeholder: "Comment on this element", "aria-label": "Comment", "data-key": "composer",
      oninput: (ev: Event) => { composerDraft = (ev.target as HTMLTextAreaElement).value; },
      onkeydown: (ev: Event) => {
        if (!isSendKey(ev as KeyboardEvent)) return;
        ev.preventDefault();
        // Enter adds a draft; Ctrl or Cmd plus Enter sends this one comment now
        if ((ev as KeyboardEvent).ctrlKey || (ev as KeyboardEvent).metaKey) send();
        else addDraft();
      },
    }) as HTMLTextAreaElement;
    box.value = composerDraft;
    return h("div", { class: "tb-composer" },
      h("div", { class: "tb-composer-top" },
        h("span", { class: "target" }, targetLabel(composer!.ref)),
        h("span", { class: "tb-hint" }, `to ${s.agent.name ?? "the agent"}`),
        h("button", { type: "button", class: "tb-x", "aria-label": "Cancel", title: "Cancel", "data-key": "cancel", onclick: closeComposer }, "✕")),
      box,
      h("div", { class: "tb-row" },
        h("button", { type: "button", class: "tb-btn", "data-key": "send", onclick: send }, "Send now"),
        h("button", { type: "button", class: "tb-btn primary", "data-key": "draft", onclick: addDraft }, "Add draft")));
  };

  const itemFor = (t: ThreadDto, history: boolean): HTMLElement => {
    const s = store.get();
    const open = history ? historyOpenId === t.id : s.activeThreadId === t.id;
    const shown = t.messages.filter((m) => !m.discarded);
    const confirmNow = confirming && confirming.threadId === t.id ? confirming : null;
    return threadItem(h, t, {
      open,
      label: targetLabel(t.element),
      missing: !history && !finder.find(t),
      history,
      draft: replyDrafts.get(t.id) ?? "",
      onToggle: () => {
        if (history) {
          historyOpenId = historyOpenId === t.id ? null : t.id;
          draw();
        } else toggleThread(t);
      },
      onDraft: (text) => replyDrafts.set(t.id, text),
      onReply: (text) => reply(t, text),
      queued: sendQueue.items().flatMap((item) => (item.job.kind === "reply" && item.job.threadId === t.id ? [queuedView(item, null)] : [])),
      onResolve: () => run(() => api.resolve(t.id, { by: "user" })),
      onReopen: () => run(() => api.reopen(t.id), () => { tab = "open"; }),
      onRelease: () => run(() => api.release(t.id)),
      onRestore: (messageId) => {
        confirming = { threadId: t.id, messageId };
        draw();
      },
      confirm: confirmNow
        ? {
            messageId: confirmNow.messageId,
            view: restoreConfirm(h, {
              number: shown.findIndex((m) => m.id === confirmNow.messageId) + 1,
              blocked: restoreDisabledReason(s),
              onRewind: () => rewind(t, confirmNow.messageId, shown.findIndex((m) => m.id === confirmNow.messageId) + 1),
              onKeep: () => {
                confirming = null;
                draw();
              },
            }),
          }
        : null,
    });
  };

  const historyView = (): HTMLElement => {
    const s = store.get();
    const partly = s.threads.filter((t) => t.messages.some((m) => m.discarded));
    const items = [...s.history, ...partly];
    const list = h("div", { class: "tb-list" });
    if (!items.length) list.append(emptyState(h, "Nothing in history yet", "Threads removed by a restore and threads from finished branches show up here."));
    for (const t of items) list.append(itemFor(t, true));
    return list;
  };

  const listView = (): HTMLElement => {
    const s = store.get();
    const list = h("div", { class: "tb-list" });
    if (!s.loaded) {
      if (!s.error) list.append(emptyState(h, "Loading comments…"));
      return list;
    }
    const shown = visibleThreads(s.threads, tab);
    if (!shown.length) {
      const none = visibleThreads(s.threads, "open").length + visibleThreads(s.threads, "resolved").length === 0;
      list.append(none
        ? emptyState(h, "No comments on this branch yet", "Switch to comment mode, then click any element on the page.")
        : tab === "open"
          ? emptyState(h, "Nothing open", "Every thread on this branch is resolved.")
          : emptyState(h, "Nothing resolved yet", "Resolved threads show up here."));
      return list;
    }
    const placed = shown.filter((t) => finder.find(t));
    const detached = shown.filter((t) => !finder.find(t));
    for (const t of placed) list.append(itemFor(t, false));
    if (detached.length) list.append(detachedList(h, detached, (t) => itemFor(t, false)));
    return list;
  };

  const banner = (): HTMLElement | null =>
    permissionBanner(h, {
      state: notificationState(),
      dismissed: notificationState() === "denied" ? blockedHidden : dismissed,
      onAllow: () => {
        const Alert = (globalThis as { Notification?: { requestPermission(): Promise<unknown> } }).Notification;
        Promise.resolve(Alert?.requestPermission()).then(draw, draw);
      },
      onNotNow: () => {
        dismissed = true;
        rememberNotNow(storage, SAVED_KEY);
        draw();
      },
      onAskAgain: () => {
        dismissed = false;
        draw();
      },
      onDismiss: () => {
        blockedHidden = true;
        rememberNotNow(storage, BLOCKED_KEY);
        draw();
      },
    });

  let lastLook = "";
  let lastActive: string | null = null;
  let lastConfirm: string | null = null;

  const draw = () => {
    if (panel.hasAttribute("hidden")) return;
    const s = store.get();
    const detachedIds = s.threads.filter((t) => !finder.find(t)).map((t) => t.id);
    const look = JSON.stringify([
      s.threads, s.history, s.branch, s.agent, s.restoreBlocked, s.loaded, s.error, s.activeThreadId,
      tab, showHistory, historyOpenId, composer?.ref.selector ?? null, sendQueue.items(), drafts, confirming, notice,
      notificationState(), dismissed, blockedHidden, detachedIds,
    ]);
    if (look === lastLook) return;
    lastLook = look;

    const scroller = panel.querySelector(".tb-list") as HTMLElement | null;
    const scrolled = scroller?.scrollTop ?? 0;
    const owner = panel.getRootNode() as ShadowRoot;
    const focused = (owner.activeElement as HTMLElement | null)?.getAttribute?.("data-key") ?? null;
    const caret = focused ? (owner.activeElement as HTMLTextAreaElement) : null;
    const from = caret?.selectionStart ?? null;
    const to = caret?.selectionEnd ?? null;

    while (panel.firstChild) panel.removeChild(panel.firstChild);
    panel.append(header());
    if (composer) {
      panel.append(composerView());
    } else {
      if (!showHistory && !confirming) {
        const note = banner();
        if (note) panel.append(note);
      }
      if (s.error) panel.append(h("div", { class: "tb-banner blocked", role: "alert" }, s.error));
      if (notice) panel.append(h("div", { class: "tb-banner blocked", role: "alert" }, notice));
      if (showHistory) {
        panel.append(h("div", { class: "tb-subhead" },
          h("button", { type: "button", class: "tb-btn", "data-key": "back", onclick: () => { showHistory = false; draw(); } }, "Back"),
          h("b", null, "History")));
        panel.append(historyView());
      } else {
        if (s.loaded && s.threads.length) panel.append(tabs());
        const list = listView();
        const comments = sendQueue.items().flatMap((item) => (item.job.kind === "comment" ? [queuedView(item, targetLabel(item.job.ref))] : []));
        // the drafts and the waiting comments scroll with the list, so they can never squeeze it
        if (comments.length) {
          list.insertBefore(h("div", { class: "tb-queue" },
            h("div", { class: "tb-section" }, "Waiting to send"),
            ...comments.map((q) => queuedItem(h, q))), list.firstChild);
        }
        if (tab === "open" && drafts.length) list.insertBefore(draftsBlock(), list.firstChild);
        panel.append(list);
        panel.append(h("div", { class: "tb-foot" },
          h("button", { type: "button", class: "tb-link", "data-key": "history", onclick: () => { showHistory = true; draw(); } },
            `History (${s.history.length})`)));
      }
    }

    const list = panel.querySelector(".tb-list") as HTMLElement | null;
    if (list) list.scrollTop = scrolled;
    if (s.activeThreadId !== lastActive) {
      lastActive = s.activeThreadId;
      (panel.querySelector(".tb-thread.active") as HTMLElement | null)?.scrollIntoView?.({ block: "nearest" });
    }
    const confirmKey = confirming ? `${confirming.threadId}/${confirming.messageId}` : null;
    if (confirmKey !== lastConfirm) {
      lastConfirm = confirmKey;
      (panel.querySelector(".tb-confirm") as HTMLElement | null)?.scrollIntoView?.({ block: "nearest" });
    }
    place();
    if (focused) {
      const again = panel.querySelector(`[data-key="${focused}"]`) as HTMLElement | null;
      again?.focus?.({ preventScroll: true });
      if (again && from !== null && to !== null && "setSelectionRange" in again) {
        try {
          (again as HTMLTextAreaElement).setSelectionRange(from, to);
        } catch {
          // buttons have no selection
        }
      }
    }
  };

  // ---- placement and dragging ----

  const place = () => {
    if (!moved) return;
    panel.style.maxHeight = "";
    const r = panel.getBoundingClientRect();
    const pill = (panel.getRootNode() as ShadowRoot).querySelector?.(".tb-modes")?.getBoundingClientRect();
    const fit = clampToViewport(
      { x: moved.x, y: moved.y, w: r.width, h: r.height },
      o.viewport(),
      pill && { x: pill.left, y: pill.top, w: pill.width, h: pill.height },
    );
    moved = { x: fit.x, y: fit.y };
    Object.assign(panel.style, {
      left: `${fit.x}px`, top: `${fit.y}px`, right: "auto", bottom: "auto",
      maxHeight: fit.maxHeight === undefined ? "" : `${fit.maxHeight}px`,
    });
  };

  const startDrag = (ev: Event) => {
    const e = ev as PointerEvent;
    const target = e.target as Element | null;
    if (!target?.closest(".tb-head") || target.closest("button")) return;
    const r = panel.getBoundingClientRect();
    const dx = e.clientX - r.left;
    const dy = e.clientY - r.top;
    try {
      panel.setPointerCapture(e.pointerId);
    } catch {
      // capture is only a convenience
    }
    const move = (m: Event) => {
      const p = m as PointerEvent;
      moved = { x: p.clientX - dx, y: p.clientY - dy };
      place();
    };
    const stop = () => {
      panel.removeEventListener("pointermove", move);
      panel.removeEventListener("pointerup", stop);
      panel.removeEventListener("pointercancel", stop);
    };
    panel.addEventListener("pointermove", move);
    panel.addEventListener("pointerup", stop);
    panel.addEventListener("pointercancel", stop);
  };
  panel.addEventListener("pointerdown", startDrag);

  const onResize = () => place();
  win.addEventListener("resize", onResize);

  // ---- follow the store ----

  const sync = () => {
    const s = store.get();
    const visible = s.panelOpen && s.mode !== "hidden";
    const was = !panel.hasAttribute("hidden");
    if (visible && !was) {
      panel.removeAttribute("hidden");
      lastLook = "";
      place();
    } else if (!visible && was) panel.setAttribute("hidden", "");
    draw();
    if (visible && !was && composer) (panel.querySelector('[data-key="composer"]') as HTMLElement | null)?.focus?.();
  };
  const unsub = store.subscribe(sync);
  sync();

  return {
    compose(ref) {
      compose(ref);
      (panel.querySelector('[data-key="composer"]') as HTMLElement | null)?.focus?.();
    },
    openThread,
    destroy() {
      unsub();
      sendQueue.destroy();
      win.removeEventListener("resize", onResize);
      for (const t of timers) clearTimeout(t);
      panel.remove();
      flashLayer.remove();
    },
  };
}
