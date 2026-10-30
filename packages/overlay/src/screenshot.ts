// A picture of one element, cut out of a picture of the whole visible tab.
import { LIMITS } from "@app/shared";

export type Box = { x: number; y: number; w: number; h: number };

const MIN_SHOWING = 4;

const boxOf = (el: Element): Box => {
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
};

/** The part of the box that is inside the window, or null when less than 4 px of it shows. */
export function visiblePart(r: Box, view: { w: number; h: number }): Box | null {
  const x = Math.max(0, r.x);
  const y = Math.max(0, r.y);
  const w = Math.min(view.w, r.x + r.w) - x;
  const h = Math.min(view.h, r.y + r.h) - y;
  return w < MIN_SHOWING || h < MIN_SHOWING ? null : { x, y, w, h };
}

/** The same box in pixels of the picture. The picture is sharper than the page on a retina screen or a zoomed page, so scale by the width ratio. */
export function inPicture(box: Box, viewWidth: number, pictureWidth: number): Box {
  const k = pictureWidth / viewWidth;
  return { x: Math.round(box.x * k), y: Math.round(box.y * k), w: Math.round(box.w * k), h: Math.round(box.h * k) };
}

export function bytesOfDataUrl(url: string): Uint8Array {
  const comma = url.indexOf(",");
  if (!url.startsWith("data:") || comma < 0) throw new Error("The browser did not give a picture");
  return Uint8Array.from(atob(url.slice(comma + 1)), (c) => c.charCodeAt(0));
}

function base64Of(bytes: Uint8Array): string {
  let text = "";
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
}

export type ShotOptions = {
  el: Element;
  win: Window;
  /** The overlay's own element. It is hidden while the picture is taken. */
  host: HTMLElement;
  /** A data URL of the visible tab. */
  captureTab: () => Promise<string>;
};

const nextFrames = (win: Window) =>
  new Promise<void>((done) => {
    const fallback = win.setTimeout(done, 200);
    win.requestAnimationFrame(() => win.requestAnimationFrame(() => (win.clearTimeout(fallback), done())));
  });

/** Why a picture cannot be taken of this element right now, or null when it can. */
export function whyNoShot(el: Element, win: Window): string | null {
  if (win !== win.top) return "Screenshots are not available inside a frame";
  return visiblePart(boxOf(el), { w: win.innerWidth, h: win.innerHeight })
    ? null
    : "Scroll the element into view to attach a screenshot";
}

/** Returns the element's picture as base64 PNG text, small enough for the daemon. */
export async function elementScreenshot(o: ShotOptions): Promise<string> {
  const { el, win, host } = o;
  const why = whyNoShot(el, win);
  if (why) throw new Error(why);
  const part = visiblePart(boxOf(el), { w: win.innerWidth, h: win.innerHeight })!;
  const was = host.style.visibility;
  host.style.visibility = "hidden";
  let url: string;
  try {
    await nextFrames(win);
    url = await o.captureTab();
  } finally {
    host.style.visibility = was;
  }
  const bitmap = await win.createImageBitmap(new Blob([bytesOfDataUrl(url) as BlobPart], { type: "image/png" }));
  const box = inPicture(part, win.innerWidth, bitmap.width);
  for (let scale = 1; scale >= 0.2; scale *= 0.7) {
    const canvas = win.document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(box.w * scale));
    canvas.height = Math.max(1, Math.round(box.h * scale));
    canvas.getContext("2d")!.drawImage(bitmap, box.x, box.y, box.w, box.h, 0, 0, canvas.width, canvas.height);
    const png = await new Promise<Blob | null>((done) => canvas.toBlob(done, "image/png"));
    if (!png) throw new Error("The browser could not make the picture");
    if (png.size <= LIMITS.screenshot) return base64Of(new Uint8Array(await png.arrayBuffer()));
  }
  throw new Error("The screenshot is too large to send");
}
