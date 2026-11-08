import { brand } from "@app/shared";
import type { Confidence } from "@app/shared";

export type SourceInfo = { component?: string[]; source?: string; confidence: Confidence };

type Fiber = { type?: unknown; return?: Fiber | null; _debugStack?: { stack?: unknown }; _debugSource?: { fileName?: string; lineNumber?: number } };
type Found = { source?: string; component?: string[] };

/** A file path as the agent wants it: no origin, query or Vite prefix, and from "src/" when the path has one. */
function trimPath(raw: string): string {
  let p = raw.replace(/^(?:https?|file):\/\/[^/]*/, "").split(/[?#]/)[0] ?? raw;
  p = p.replace(/^\/@fs/, "");
  const at = p.lastIndexOf("/src/");
  return at >= 0 ? p.slice(at + 1) : p.replace(/^\//, "");
}

/** The nearest element (itself first) for which `read` returns something. */
function up<T>(el: Element, read: (e: Element) => T | undefined): T | undefined {
  for (let cur: Element | null = el; cur; cur = cur.parentElement) {
    const got = read(cur);
    if (got !== undefined) return got;
  }
  return undefined;
}

/** Layer 1, any framework: the attribute set by the dev plugin (optional), then Astro's own dev attributes. */
function attrSource(el: Element): string | undefined {
  return up(el, (e) => {
    const own = e.getAttribute(brand.sourceAttr);
    if (own) return own;
    const file = e.getAttribute("data-astro-source-file");
    if (!file) return undefined;
    const line = (e.getAttribute("data-astro-source-loc") ?? "").split(":")[0];
    return trimPath(file) + (line ? `:${line}` : "");
  });
}

/** React puts its fiber on the DOM node under a key that starts with this prefix. */
function fiberOf(el: Element): Fiber | null {
  for (const key of Object.keys(el)) {
    if (key.startsWith("__reactFiber$")) return (el as unknown as Record<string, Fiber>)[key] ?? null;
  }
  return null;
}

/** A name for a component type: a function, a memo or forwardRef wrapper around one, or anything with a displayName. */
function componentName(type: unknown, depth = 0): string | undefined {
  if (typeof type === "function") {
    const fn = type as { displayName?: unknown; name?: unknown };
    const shown = typeof fn.displayName === "string" ? fn.displayName : "";
    return shown || (typeof fn.name === "string" ? fn.name : "") || undefined;
  }
  if (type && typeof type === "object" && depth < 3) {
    const obj = type as { displayName?: unknown; type?: unknown; render?: unknown };
    if (typeof obj.displayName === "string" && obj.displayName) return obj.displayName;
    return componentName(obj.type, depth + 1) ?? componentName(obj.render, depth + 1);
  }
  return undefined;
}

const LIBRARY_FRAME = /\/node_modules\/|\.vite\/deps|\/@vite\/|\/@react-refresh/;
const STACK_FRAME = /((?:https?|file):\/\/[^\s()]+?):(\d+):\d+\)?\s*$/;
/** Context and routing wrappers say nothing about where an element lives. */
const WRAPPER_NAME = /(?:Provider|Consumer|Context|Boundary|Router|Routes)$|^(?:Suspense|StrictMode|Fragment)$/;
const MAX_NAMES = 6;
const MAX_FIBERS = 60;

/** file:line of the first stack frame that is the user's own code. React 19 dev builds keep this stack on every fiber. */
function userFrame(stack: unknown): string | undefined {
  if (typeof stack !== "string") return undefined;
  for (const line of stack.split("\n")) {
    const hit = STACK_FRAME.exec(line);
    if (hit && !LIBRARY_FRAME.test(hit[1]!)) return `${trimPath(hit[1]!)}:${hit[2]}`;
  }
  return undefined;
}

/** React: component names from the fiber chain (nearest few), and the location from the nearest fiber that has one. */
function reactInfo(el: Element): Found | undefined {
  const start = up(el, (e) => fiberOf(e) ?? undefined);
  if (!start) return undefined;
  const names: string[] = [];
  let source: string | undefined;
  let n = 0;
  for (let fiber: Fiber | null = start; fiber && n < MAX_FIBERS; fiber = fiber.return ?? null, n++) {
    const name = componentName(fiber.type);
    if (name && !WRAPPER_NAME.test(name)) names.push(name);
    if (!source) {
      const dbg = fiber._debugSource;
      source = dbg?.fileName ? `${trimPath(dbg.fileName)}:${dbg.lineNumber ?? 1}` : userFrame(fiber._debugStack?.stack);
    }
  }
  return { source, component: names.slice(0, MAX_NAMES).reverse() };
}

/** Svelte (dev): every element carries the place it was compiled from. */
function svelteInfo(el: Element): Found | undefined {
  const loc = up(el, (e) => (e as unknown as { __svelte_meta?: { loc?: { file?: string; line?: number } } }).__svelte_meta?.loc);
  return loc?.file ? { source: `${trimPath(loc.file)}:${loc.line ?? 1}` } : undefined;
}

type VueInstance = { type?: { __file?: string; name?: string; __name?: string }; parent?: VueInstance | null };

/** Vue: the owning component instance gives its file and name; parents give the chain. */
function vueInfo(el: Element): Found | undefined {
  const inst = up(el, (e) => (e as unknown as { __vueParentComponent?: VueInstance }).__vueParentComponent);
  if (!inst) return undefined;
  const names: string[] = [];
  for (let c: VueInstance | null | undefined = inst, n = 0; c && n < MAX_FIBERS; c = c.parent, n++) {
    const name = c.type?.name || c.type?.__name;
    if (name) names.push(name);
  }
  const file = inst.type?.__file;
  return { source: file ? trimPath(file) : undefined, component: names.slice(0, MAX_NAMES).reverse() };
}

/**
 * Nothing to install: everything is read from what the dev server already puts on the page.
 * The first layer that answers wins for the location; component names come from React or Vue.
 * Each reader is guarded, so a framework that changes its internals gives less, never an error.
 */
export function readSourceInfo(el: Element): SourceInfo {
  let source = attrSource(el);
  let names: string[] = [];
  for (const read of [reactInfo, svelteInfo, vueInfo]) {
    try {
      const found = read(el);
      if (!found) continue;
      source ??= found.source;
      if (found.component?.length && !names.length) names = found.component;
    } catch {
      /* the framework's internals changed; skip this layer */
    }
  }
  const info: SourceInfo = { confidence: source ? "source" : names.length ? "component" : "text" };
  if (names.length) info.component = names;
  if (source) info.source = source;
  return info;
}
