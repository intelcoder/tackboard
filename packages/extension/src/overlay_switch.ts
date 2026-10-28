import { brand } from "@app/shared";

/** Puts the overlay in a page when the site is on, and takes it out when the site is turned off. */
export function createOverlaySwitch(options: { document: Document; isOn: () => Promise<boolean>; mount: () => { destroy(): void } }) {
  let mine: { destroy(): void } | null = null;
  return {
    async refresh(): Promise<void> {
      const on = await options.isOn();
      if (on && !mine && !options.document.getElementById(brand.hostId)) mine = options.mount();
      if (!on && mine) {
        mine.destroy();
        mine = null;
      }
    },
  };
}
