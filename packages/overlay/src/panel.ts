// The comments panel: a floating window with the thread list, the comment box and History.
import { brand } from "@app/shared";
import type { ElementRef, ThreadDto } from "@app/shared";
import type { Api } from "./api.ts";
import type { H } from "./dom.ts";
import { findElement } from "./element_ref.ts";
import { notificationState, permissionAsked, permissionBanner, rememberNotNow } from "./notifications.ts";
import { badgeCount, clampToViewport, errorText, restoreDisabledReason, visibleThreads } from "./panel_logic.ts";
import type { Tab } from "./panel_logic.ts";
import type { Store } from "./store.ts";
import { toastText } from "./toast.ts";
import { detachedList, emptyState, restoreConfirm, splitByElement, targetLabel, threadItem } from "./thread_view.ts";

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

const FLASH_MS = 1800;
const SAVED_KEY = `${brand.configGlobal}:notify-later`;

function storageOf(win: Window): Storage | undefined {
  try {
    return win.localStorage;
  } catch {
    return undefined;
  }
}

export function createPanel(o: PanelOptions): Panel {
  const { document: doc, window: win, layer, h, store, api } = o;
  const storage = storageOf(win);

  // What only the panel cares about. Anything the pins or pill need lives in the store.
  let tab: Tab = "open";
  let showHistory = false;
  let historyOpenId: string | null = null;
  let composer: { ref: ElementRef } | null = null;
  let composerDraft = "";
  let composerError: string | null = null;
  let sending = false;
  let confirming: { threadId: string; messageId: string } | null = null;
  let notice: string | null = null;
  let dismissed = permissionAsked(storage, SAVED_KEY);
  let moved: { x: number; y: number } | null = null;
  const replyDrafts = new Map<string, string>();
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

  // ---- store helpers ----

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

  const openThread = (id: string, scroll = false) => {
    const t = store.get().threads.find((x) => x.id === id);
    if (!t) return;
    goTo(t);
    markRead(t);
    if (!scroll) return;
    const el = findElement(t.element, doc);
    if (!el) return;
    try {
      el.scrollIntoView({ block: "center", behavior: reducedMotion() ? "auto" : "smooth" });
    } catch {
      // not every environment can scroll
    }
    flash(el);
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

  const reply = (t: ThreadDto, text: string) =>
    run(() => api.postMessage(t.id, { author: "user", text }), () => {
      replyDrafts.delete(t.id);
      tab = "open";
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
    composerError = null;
    showHistory = false;
    store.set({ composing: true, panelOpen: true, activeThreadId: null });
  };

  const closeComposer = () => {
    composer = null;
    store.set({ composing: false });
  };

  const send = () => {
    const text = composerDraft.trim();
    if (!composer || !text || sending) return;
    sending = true;
    composerError = null;
    draw();
    api.postThread({ element: composer.ref, url: win.location.href, viewport: o.viewport(), text }).then(
      (t) => {
        sending = false;
        composer = null;
        saveThread(t);
        tab = "open";
        store.set({ composing: false, mode: "view", activeThreadId: t.id, panelOpen: true });
        o.refresh();
      },
      (e) => {
        sending = false;
        composerError = errorText(e);
        draw();
      },
    );
  };

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
        const key = ev as KeyboardEvent;
        if (key.key === "Enter" && (key.metaKey || key.ctrlKey)) {
          key.preventDefault();
          send();
        }
      },
    }) as HTMLTextAreaElement;
    box.value = composerDraft;
    return h("div", { class: "tb-composer" },
      h("span", { class: "target" }, targetLabel(composer!.ref)),
      box,
      composerError ? h("span", { class: "tb-error", role: "alert" }, composerError) : null,
      h("div", { class: "tb-row" },
        h("span", { class: "tb-hint" }, `Goes to ${s.agent.name ?? "the agent"}`),
        h("button", { type: "button", class: "tb-btn", "data-key": "cancel", onclick: closeComposer }, "Cancel"),
        h("button", { type: "button", class: "tb-btn primary", "data-key": "send", disabled: sending, onclick: send }, sending ? "Sending…" : "Send")));
  };

  const itemFor = (t: ThreadDto, history: boolean): HTMLElement => {
    const s = store.get();
    const open = history ? historyOpenId === t.id : s.activeThreadId === t.id;
    const shown = t.messages.filter((m) => !m.discarded);
    const confirmNow = confirming && confirming.threadId === t.id ? confirming : null;
    return threadItem(h, t, {
      open,
      label: targetLabel(t.element),
      missing: !history && !findElement(t.element, doc),
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
    const { placed, detached } = splitByElement(shown, doc);
    for (const t of placed) list.append(itemFor(t, false));
    if (detached.length) list.append(detachedList(h, detached, (t) => itemFor(t, false)));
    return list;
  };

  const banner = (): HTMLElement | null =>
    permissionBanner(h, {
      state: notificationState(),
      dismissed,
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
    });

  let lastLook = "";
  let lastActive: string | null = null;

  const draw = () => {
    if (panel.hasAttribute("hidden")) return;
    const s = store.get();
    const detachedIds = s.threads.filter((t) => !findElement(t.element, doc)).map((t) => t.id);
    const look = JSON.stringify([
      s.threads, s.history, s.branch, s.agent, s.restoreBlocked, s.loaded, s.error, s.activeThreadId,
      tab, showHistory, historyOpenId, composer?.ref.selector ?? null, composerError, sending, confirming, notice,
      notificationState(), dismissed, detachedIds,
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
      if (!showHistory) {
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
        panel.append(listView());
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
    place();
    if (focused) {
      const again = panel.querySelector(`[data-key="${focused}"]`) as HTMLElement | null;
      again?.focus?.();
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
      win.removeEventListener("resize", onResize);
      for (const t of timers) clearTimeout(t);
      panel.remove();
      flashLayer.remove();
    },
  };
}
