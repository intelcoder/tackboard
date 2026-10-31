import { brand, LIMITS } from "@app/shared";
import type { PageError } from "@app/shared";

// The recorder runs in the page's own JavaScript world (the overlay cannot see the page's console from its separate one) and answers over DOM events, which cross worlds. The answer is a JSON string because an object in `detail` does not.
const ASK = `${brand.cli}:errors`;
const ANSWER = `${brand.cli}:errors-answer`;

type Page = Window & typeof globalThis;

function show(value: unknown): string {
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

/** Path only: never the query string. Another host keeps its host. */
function where(win: Page, input: unknown): string {
  try {
    const url = new URL(input instanceof Request ? input.url : String(input), win.location.href);
    return url.origin === win.location.origin ? url.pathname : `${url.host}${url.pathname}`;
  } catch {
    return "?";
  }
}

export function installRecorder(win: Page): void {
  const lines: PageError[] = [];
  const add = (kind: PageError["kind"], text: string) => {
    lines.push({ kind, text: text.slice(0, LIMITS.pageErrorText) });
    if (lines.length > LIMITS.pageErrors) lines.shift();
  };

  for (const kind of ["error", "warn"] as const) {
    const original = win.console[kind];
    win.console[kind] = function (this: Console, ...args: unknown[]) {
      add(kind, args.map(show).join(" "));
      return original.apply(this, args);
    };
  }
  win.addEventListener("error", (e) => add("error", e.filename ? `${e.message} (${e.filename.split("?")[0]}:${e.lineno})` : e.message));
  win.addEventListener("unhandledrejection", (e) => add("error", `Unhandled rejection: ${show(e.reason)}`));

  const realFetch = win.fetch;
  win.fetch = function (this: unknown, input: RequestInfo | URL, init?: RequestInit) {
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    const label = `${method} ${where(win, input)}`;
    return realFetch.call(this, input, init).then(
      (res) => {
        if (res.status >= 400) add("network", `${label} ${res.status}`);
        return res;
      },
      (err) => {
        if ((err as Error)?.name !== "AbortError") add("network", `${label} failed: ${show(err)}`);
        throw err;
      },
    );
  };

  const open = win.XMLHttpRequest.prototype.open;
  win.XMLHttpRequest.prototype.open = function (this: XMLHttpRequest & { _label?: string }, method: string, url: string | URL, ...rest: unknown[]) {
    this._label = `${method.toUpperCase()} ${where(win, url)}`;
    this.addEventListener("loadend", () => {
      if (this.status >= 400) add("network", `${this._label} ${this.status}`);
    });
    this.addEventListener("error", () => add("network", `${this._label} failed`));
    return (open as Function).call(this, method, url, ...rest);
  } as typeof open;

  win.document.addEventListener(ASK, () => win.document.dispatchEvent(new CustomEvent(ANSWER, { detail: JSON.stringify(lines) })));
}

/** From the overlay's world: what the recorder has so far, or null when there is no recorder on this page. */
export function askRecorder(doc: Document): PageError[] | null {
  let got: PageError[] | null = null;
  const on = (e: Event) => {
    try {
      got = JSON.parse((e as CustomEvent).detail);
    } catch {}
  };
  doc.addEventListener(ANSWER, on);
  doc.dispatchEvent(new CustomEvent(ASK));
  doc.removeEventListener(ANSWER, on);
  return got;
}
