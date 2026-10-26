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
import { baseCss } from "./styles_base.ts";

export type MountOptions = {
  document?: Document;
  window?: Window;
  config: { base: string; token: string };
  viewport?: () => { w: number; h: number };
  /** Called when the user picks an element in comment mode. T9 wires this to the Composer. */
  onPick?: (ref: ElementRef, el: Element) => void;
  /** Called when a pin is clicked. T9 wires this to the panel. */
  onPin?: (threadId: string) => void;
};

export type Overlay = {
  host: HTMLElement;
  root: ShadowRoot;
  store: Store;
  api: Api;
  destroy(): void;
};

export function mountOverlay(opts: MountOptions): Overlay {
  const doc = opts.document ?? document;
  const win = (opts.window ?? doc.defaultView ?? globalThis.window) as Window;
  const h = createH(doc);
  const store = createStore();
  const api = createApi(opts.config);
  const viewport = opts.viewport ?? (() => ({ w: win.innerWidth, h: win.innerHeight }));

  const host = h("div", { id: brand.hostId });
  host.style.cssText =
    "all:initial;position:fixed;inset:0;pointer-events:none;z-index:2147483647;";
  const root = host.attachShadow({ mode: "open" });

  // A constructed stylesheet is not blocked by a page's style-src CSP; <style> is the fallback.
  const Sheet = (win as any).CSSStyleSheet;
  if (Sheet && "adoptedStyleSheets" in root) {
    const sheet = new Sheet();
    sheet.replaceSync(baseCss);
    (root as any).adoptedStyleSheets = [sheet];
  } else {
    root.append(h("style", null, baseCss));
  }

  const pinLayer = h("div", { class: "tb-pins" });
  const hoverLayer = h("div", { class: "tb-hover" });
  const dock = h("div", { class: "tb-dock" }, createModeSwitch(h, store));
  root.append(pinLayer, hoverLayer, dock);
  // After <body>, so the host never shifts the nth-child paths of the page's own elements.
  doc.documentElement.append(host);

  const pins = createPins({ document: doc, window: win, layer: pinLayer, h, store, viewport, onPin: opts.onPin ?? (() => {}) });
  const hover = createHover({ document: doc, window: win, host, layer: hoverLayer, h, store, onPick: opts.onPick ?? (() => {}) });

  return {
    host,
    root,
    store,
    api,
    destroy() {
      hover.destroy();
      pins.destroy();
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
