import type { H } from "./dom.ts";
import type { Mode, Store } from "./store.ts";

const ICONS: Record<string, string[]> = {
  hidden: ["M3 3l18 18M10.6 6.1A9.8 9.8 0 0 1 12 6c5 0 8.5 4 9.5 6a14 14 0 0 1-2.6 3.3M6.6 6.7A14 14 0 0 0 2.5 12c1 2 4.5 6 9.5 6a9.7 9.7 0 0 0 3.2-.6"],
  view: ["M2.5 12C3.5 10 7 6 12 6s8.5 4 9.5 6c-1 2-4.5 6-9.5 6s-8.5-4-9.5-6z"],
  comment: ["M4 4h12M4 4v12M4 8v-4M4 20h5M20 4v5", "M12 12l8 3.2-3.4 1.4-1.4 3.4z"],
  panel: ["M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"],
};

/**
 * ModeSwitch plus PanelToggle in one dark pill. It is the only element that stays
 * in every mode. The mode controller is the store itself: clicking a tool sets `mode`,
 * and the other parts (hover, pins, the poller) subscribe to it.
 */
export function createModeSwitch(h: H, store: Store): HTMLElement {
  const icon = (name: string) => {
    const paths = ICONS[name]!;
    const svg = h("svg", { viewBox: "0 0 24 24", "aria-hidden": "true" });
    paths.forEach((d, i) => svg.append(h("path", { d, "stroke-dasharray": name === "comment" && i === 0 ? "2 3" : null })));
    return svg;
  };
  const tool = (mode: Mode, label: string) =>
    h("button", {
      type: "button",
      "data-mode": mode,
      "aria-label": label,
      title: label,
      "aria-pressed": "false",
      onclick: () => store.set({ mode }),
    }, icon(mode));

  const buttons = [tool("hidden", "Hidden"), tool("view", "View comments"), tool("comment", "Add comment")];
  const badge = h("span", { class: "badge", hidden: true });
  const toggle = h("button", {
    type: "button",
    "data-panel": "",
    "aria-label": "Comments",
    title: "Comments",
    "aria-pressed": "false",
    onclick: () => store.set({ panelOpen: !store.get().panelOpen }),
  }, icon("panel"), badge);

  const pill = h("div", { class: "tb-modes", role: "group", "aria-label": "Mode" },
    ...buttons, h("span", { class: "div" }), toggle);

  const sync = () => {
    const s = store.get();
    for (const b of buttons) b.setAttribute("aria-pressed", String(b.getAttribute("data-mode") === s.mode));
    toggle.setAttribute("aria-pressed", String(s.panelOpen));
    if (s.mode === "hidden") toggle.setAttribute("disabled", "");
    else toggle.removeAttribute("disabled");
    const showBadge = s.badge > 0 && !s.panelOpen;
    badge.textContent = showBadge ? String(s.badge) : "";
    if (showBadge) badge.removeAttribute("hidden");
    else badge.setAttribute("hidden", "");
  };
  store.subscribe(sync);
  sync();
  return pill;
}
