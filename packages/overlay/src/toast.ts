import { statusLabel } from "@app/shared";
import type { H } from "./dom.ts";
import type { ChangeEvent } from "./panel_logic.ts";

export type ToastEvent = ChangeEvent | { kind: "restored"; number: number };

export function toastText(event: ToastEvent): string {
  switch (event.kind) {
    case "reply":
      return `${event.agent} replied on comment ${event.n}`;
    case "received":
      return `${event.agent} ${statusLabel("received")} your comment`;
    case "resolved":
      return `Comment ${event.n} ${statusLabel("resolved")}`;
    case "restored":
      return `Project restored to message ${event.number}`;
  }
}

/** A short message that fades after a few seconds. One at a time. */
export function createToast(h: H, layer: Element, setTimer: (fn: () => void, ms: number) => unknown = setTimeout) {
  let current: HTMLElement | null = null;
  let stamp = 0;
  return {
    show(text: string) {
      current?.remove();
      const mine = ++stamp;
      current = h("div", { class: "tb-toast", role: "status" }, text);
      layer.append(current);
      setTimer(() => {
        if (mine === stamp) {
          current?.remove();
          current = null;
        }
      }, 3500);
    },
    clear() {
      stamp++;
      current?.remove();
      current = null;
    },
  };
}
