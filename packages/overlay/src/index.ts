import { brand } from "@app/shared";
import type { ElementRef } from "@app/shared";
import { createApi } from "./api.ts";
import type { Api } from "./api.ts";
import { createH } from "./dom.ts";
import { createHover } from "./hover.ts";
import { createModeSwitch } from "./modes.ts";
import { createPins } from "./pins.ts";
import { createStore } from "./store.ts";
import type { Store } from "./store.ts";
import { createPanel } from "./panel.ts";
import { badgeLabel } from "./panel_logic.ts";
import { notifyReply } from "./notifications.ts";
import { createPoller } from "./poller.ts";
import { baseCss } from "./styles_base.ts";
import { panelCss } from "./styles_panel.ts";
import { createToast, toastText } from "./toast.ts";

export type MountOptions = {
  document?: Document;
  window?: Window;
  config: { base: string; token: string };
  viewport?: () => { w: number; h: number };
  /** Milliseconds between polls of the daemon (default 1500). */
  pollEvery?: number;
  /** Called when the user picks an element in comment mode. The panel opens its comment box either way. */
  onPick?: (ref: ElementRef, el: Element) => void;
  /** Called when a pin is clicked. The panel opens that thread either way. */
  onPin?: (threadId: string) => void;
};

export type Overlay = {
  host: HTMLElement;
  root: ShadowRoot;
  store: Store;
  api: Api;
  destroy(): void;
};

export function mountOverlay(options: MountOptions): Overlay {
  const doc = options.document ?? document;
  const win = (options.window ?? doc.defaultView ?? globalThis.window) as Window;
  const h = createH(doc);
  const store = createStore();
  const api = createApi(options.config);
  const viewport = options.viewport ?? (() => ({ w: win.innerWidth, h: win.innerHeight }));

  const host = h("div", { id: brand.hostId });
  host.style.cssText =
    "all:initial;position:fixed;inset:0;pointer-events:none;z-index:2147483647;";
  const root = host.attachShadow({ mode: "open" });

  // A constructed stylesheet is not blocked by a page's style-src CSP; <style> is the fallback.
  const Sheet = (win as any).CSSStyleSheet;
  if (Sheet && "adoptedStyleSheets" in root) {
    const sheet = new Sheet();
    sheet.replaceSync(baseCss + panelCss);
    (root as any).adoptedStyleSheets = [sheet];
  } else {
    root.append(h("style", null, baseCss + panelCss));
  }

  const pinLayer = h("div", { class: "tb-pins" });
  const hoverLayer = h("div", { class: "tb-hover" });
  const dock = h("div", { class: "tb-dock" }, createModeSwitch(h, store));
  const panelLayer = h("div", { class: "tb-panel-layer" });
  root.append(pinLayer, hoverLayer, panelLayer, dock);
  // After <body>, so the host never shifts the nth-child paths of the page's own elements.
  doc.documentElement.append(host);

  const toast = createToast(h, panelLayer);
  const poller = createPoller({
    store,
    api,
    every: options.pollEvery ?? 1500,
    onEvents: (events) => {
      for (const event of events) {
        toast.show(toastText(event));
        notifyReply(event);
      }
    },
  });
  const panel = createPanel({
    document: doc, window: win, layer: panelLayer, h, store, api, viewport,
    refresh: poller.now, showToast: toast.show,
  });
  const pins = createPins({
    document: doc, window: win, layer: pinLayer, h, store, viewport,
    onPin: (id) => {
      panel.openThread(id);
      options.onPin?.(id);
    },
  });
  const hover = createHover({
    document: doc, window: win, host, layer: hoverLayer, h, store,
    onPick: (ref, el) => {
      panel.compose(ref, el);
      options.onPick?.(ref, el);
    },
  });

  // The pill is built in modes.ts; its label follows the count here.
  const toggle = root.querySelector("[data-panel]");
  const relabel = () => {
    const s = store.get();
    const text = badgeLabel(s.panelOpen ? 0 : s.badge);
    toggle?.setAttribute("aria-label", text);
    toggle?.setAttribute("title", text);
    if (s.mode === "hidden") toast.clear();
  };
  const stopLabels = store.subscribe(relabel);
  relabel();

  return {
    host,
    root,
    store,
    api,
    destroy() {
      stopLabels();
      hover.destroy();
      pins.destroy();
      panel.destroy();
      poller.destroy();
      toast.clear();
      host.remove();
    },
  };
}

type BootConfig = { base: string; token: string };

function boot(): void {
  if (typeof document === "undefined") return;
  const config = (globalThis as Record<string, unknown>)[brand.configGlobal] as BootConfig | undefined;
  if (!config || document.getElementById(brand.hostId)) return;
  mountOverlay({ config });
}

boot();
