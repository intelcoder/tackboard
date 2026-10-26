import type { Api } from "./api.ts";
import { badgeCount, diffForEvents, errorText } from "./panel_logic.ts";
import type { ChangeEvent } from "./panel_logic.ts";
import type { Store } from "./store.ts";

export type PollerOptions = {
  store: Store;
  api: Api;
  /** Milliseconds between polls. */
  every: number;
  onEvents(events: ChangeEvent[]): void;
};

/**
 * Asks the daemon for the thread list every `every` ms while the mode is not "hidden".
 * Only one request is in flight at a time. The first answer sets the baseline; only later
 * answers produce events, so old replies never pop up as news when the page loads.
 */
export function createPoller(o: PollerOptions): { now(): void; destroy(): void } {
  const { store, api } = o;
  let on = false;
  let busy = false;
  let again = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const poll = async () => {
    if (busy) {
      again = true;
      return;
    }
    busy = true;
    try {
      const list = await api.listThreads();
      if (!on) return;
      const before = store.get();
      store.set({
        threads: list.threads,
        history: list.history,
        branch: list.branch,
        agent: list.agent,
        restoreBlocked: list.restoreBlocked,
        loaded: true,
        error: null,
        badge: badgeCount(list.threads),
      });
      if (before.loaded) {
        const events = diffForEvents(before.threads, list.threads);
        if (events.length) o.onEvents(events);
      }
    } catch (e) {
      if (on) store.set({ error: errorText(e) });
    } finally {
      busy = false;
    }
    if (on) {
      clearTimeout(timer);
      timer = setTimeout(poll, again ? 0 : o.every);
      // A pending timer must not keep a Node process (tests) alive.
      (timer as { unref?: () => void }).unref?.();
      again = false;
    }
  };

  const sync = () => {
    const wanted = store.get().mode !== "hidden";
    if (wanted === on) return;
    on = wanted;
    if (on) void poll();
    else {
      clearTimeout(timer);
      again = false;
    }
  };

  const unsub = store.subscribe(sync);
  sync();
  return {
    now() {
      if (!on) return;
      clearTimeout(timer);
      void poll();
    },
    destroy() {
      on = false;
      clearTimeout(timer);
      unsub();
    },
  };
}
