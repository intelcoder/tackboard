// Browser notifications: state, the permission banner and the "agent replied" alert.
import type { H } from "./dom.ts";
import { bannerFor } from "./panel_logic.ts";
import type { ChangeEvent } from "./panel_logic.ts";

export type NotificationState = "granted" | "default" | "denied" | "unsupported";

type Source = { permission?: string } | undefined;

export function notificationState(source: Source = (globalThis as { Notification?: Source }).Notification): NotificationState {
  const p = source?.permission;
  return p === "granted" || p === "default" || p === "denied" ? p : "unsupported";
}

export function permissionAsked(storage: Storage | undefined, key: string): boolean {
  try {
    return storage?.getItem(key) === "1";
  } catch {
    return false;
  }
}

export function rememberNotNow(storage: Storage | undefined, key: string): void {
  try {
    storage?.setItem(key, "1");
  } catch {
    // storage can be blocked; the banner then comes back next load
  }
}

/** The notification banner (or the small link after "Not now"). Null when there is nothing to show. */
export function permissionBanner(
  h: H,
  o: { state: NotificationState; dismissed: boolean; onAllow(): void; onNotNow(): void; onAskAgain(): void; onDismiss(): void },
): HTMLElement | null {
  const kind = bannerFor(o.state, o.dismissed);
  if (kind === "ask") {
    return h("div", { class: "tb-banner", role: "status" },
      h("span", null, "Get a notification when an agent replies."),
      h("span", { class: "tb-row" },
        h("button", { type: "button", class: "tb-btn", onclick: o.onNotNow }, "Not now"),
        h("button", { type: "button", class: "tb-btn primary", onclick: o.onAllow }, "Allow")));
  }
  if (kind === "link") {
    return h("div", { class: "tb-banner small" },
      h("button", { type: "button", class: "tb-link", onclick: o.onAskAgain }, "Turn on notifications"));
  }
  if (kind === "blocked") {
    return h("div", { class: "tb-banner blocked", role: "status" },
      h("span", null, "Notifications are blocked. Change it in the browser's site settings."),
      h("button", { type: "button", class: "tb-btn", "data-key": "dismiss-blocked", onclick: o.onDismiss }, "Dismiss"));
  }
  return null;
}

/** Fires a browser notification for a new agent reply, only when permission was granted. */
export function notifyReply(event: ChangeEvent): void {
  if (event.kind !== "reply" || notificationState() !== "granted") return;
  try {
    const Alert = (globalThis as { Notification?: new (title: string, o?: { body?: string }) => unknown }).Notification;
    if (Alert) new Alert(`${event.agent} replied`, { body: event.text.slice(0, 140) });
  } catch {
    // some browsers refuse the constructor outside a service worker
  }
}
