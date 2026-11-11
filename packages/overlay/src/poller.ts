import type { Api } from "./api.ts";
import { agentConnected, badgeCount, diffForEvents, errorText } from "./panel_logic.ts";
import { agentIsUp, brand } from "@app/shared";
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
  // Agents seen connected on this page, so two agents taking turns are announced once each.
  const announced = new Set<string>();
  let lastPoll = 0;

  const poll = async () => {
    if (busy) {
      again = true;
      return;
    }
    busy = true;
    try {
      // Only this page's threads: the same branch also holds threads from other pages and sites (e.g. Storybook).
      const list = await api.listThreads({ url: globalThis.location?.href });
      if (!on) return;
      const before = store.get();
      store.set({
        threads: list.threads,
        history: list.history,
        branch: list.branch,
        project: list.project ?? null,
        otherPages: list.otherPages ?? [],
        agent: list.agent,
        restoreBlocked: list.restoreBlocked,
        loaded: true,
        error: null,
        badge: badgeCount(list.threads),
      });
      const events = before.loaded ? diffForEvents(before.threads, list.threads) : [];
      const now = Date.now();
      // After comments were hidden, or the machine slept, `before` is old: an agent that never left would look new. That poll is a fresh baseline.
      const fresh = now - lastPoll <= o.every * 4;
      lastPoll = now;
      const connected = before.loaded && fresh ? agentConnected(before.agent, list.agent, now, announced) : null;
      // A claim or reply in the same poll already names the agent, and one toast replaces the other.
      if (connected && !events.length) events.push(connected);
      if (list.agent.name !== null && agentIsUp(list.agent, now, brand.cli)) announced.add(list.agent.name);
      if (events.length) o.onEvents(events);
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
