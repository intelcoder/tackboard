import { createFinder } from "./element_ref.ts";
import type { H } from "./dom.ts";
import type { Store } from "./store.ts";

export type PinsOptions = {
  document: Document;
  window: Window;
  layer: Element;
  h: H;
  store: Store;
  viewport: () => { w: number; h: number };
  onPin: (threadId: string) => void;
};

const SIZE = 22;

/**
 * Numbered pins at the top-right corner of each thread's element. Pins are reused between
 * renders (not rebuilt) so a focused pin keeps focus while the poller refreshes the store.
 */
export function createPins(o: PinsOptions): { render(): void; destroy(): void } {
  const { document: doc, window: win, layer, h, store } = o;
  const pins = new Map<string, HTMLElement>();
  const finder = createFinder(doc, win, store);

  const render = () => {
    const s = store.get();
    const wanted = new Set<string>();
    if (s.mode !== "hidden") {
      const vp = o.viewport();
      for (const t of s.threads) {
        if (t.discarded) continue;
        const el = finder.find(t);
        if (!el) continue;
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;
        if (r.bottom < 0 || r.top > vp.h || r.right < 0 || r.left > vp.w) continue;
        wanted.add(t.id);
        let pin = pins.get(t.id);
        if (!pin) {
          const id = t.id;
          pin = h("button", { type: "button", class: "tb-pin", onclick: () => o.onPin(id) });
          pins.set(t.id, pin);
          layer.append(pin);
        }
        pin.textContent = String(t.n);
        pin.setAttribute("aria-label", `Comment ${t.n} on ${t.element.tag}`);
        if (t.status === "waiting" || t.status === "resolved") pin.setAttribute("data-status", t.status);
        else pin.removeAttribute("data-status");
        pin.classList.toggle("pulse", s.pulseThreadId === t.id);
        pin.style.left = `${Math.max(0, Math.min(vp.w - SIZE, r.right - SIZE / 2))}px`;
        pin.style.top = `${Math.max(0, Math.min(vp.h - SIZE, r.top - SIZE / 2))}px`;
      }
    }
    for (const [id, pin] of pins) {
      if (wanted.has(id)) continue;
      pin.remove();
      pins.delete(id);
    }
  };

  const unsub = store.subscribe(render);
  win.addEventListener("scroll", render, true);
  win.addEventListener("resize", render);
  render();
  return {
    render,
    destroy() {
      unsub();
      win.removeEventListener("scroll", render, true);
      win.removeEventListener("resize", render);
      for (const pin of pins.values()) pin.remove();
      pins.clear();
    },
  };
}
