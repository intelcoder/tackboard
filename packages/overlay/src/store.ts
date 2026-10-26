import type { ListThreadsResponse, ThreadDto } from "@app/shared";

export type Mode = "hidden" | "view" | "comment";

/** Everything the overlay shows. T9 (panel, poller) reads and writes this; nothing else is shared. */
export type OverlayState = {
  mode: Mode;
  panelOpen: boolean;
  /** True while the Composer is open: hover pauses so the page is not picked again. */
  composing: boolean;
  threads: ThreadDto[];
  history: ThreadDto[];
  branch: string | null;
  agent: ListThreadsResponse["agent"];
  restoreBlocked: string | null;
  /** First poll has finished. */
  loaded: boolean;
  /** Set while the daemon is unreachable. */
  error: string | null;
  /** Count shown on the PanelToggle badge (computed by T9 `badgeCount`). */
  badge: number;
  activeThreadId: string | null;
  /** Pin with this thread id pulses (scroll links). */
  pulseThreadId: string | null;
};

export type Store = {
  get(): OverlayState;
  set(patch: Partial<OverlayState>): void;
  subscribe(fn: (s: OverlayState) => void): () => void;
};

export function createStore(initial: Partial<OverlayState> = {}): Store {
  let state: OverlayState = {
    mode: "view",
    panelOpen: false,
    composing: false,
    threads: [],
    history: [],
    branch: null,
    agent: { name: null, online: false },
    restoreBlocked: null,
    loaded: false,
    error: null,
    badge: 0,
    activeThreadId: null,
    pulseThreadId: null,
    ...initial,
  };
  const subs = new Set<(s: OverlayState) => void>();
  return {
    get: () => state,
    set(patch) {
      state = { ...state, ...patch };
      for (const fn of [...subs]) fn(state);
    },
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
  };
}
