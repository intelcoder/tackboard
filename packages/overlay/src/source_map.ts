import { brand } from "@app/shared";
import type { Confidence } from "@app/shared";

export type SourceInfo = { component?: string[]; source?: string; confidence: Confidence };

type Fiber = { type?: unknown; return?: Fiber | null };

/** The value of the source attribute on the element or its nearest ancestor that has one. */
function nearestSource(el: Element): string | undefined {
  for (let cur: Element | null = el; cur; cur = cur.parentElement) {
    const value = cur.getAttribute(brand.sourceAttr);
    if (value) return value;
  }
  return undefined;
}

/** React puts its fiber on the DOM node under a key that starts with this prefix. */
function fiberOf(el: Element): Fiber | null {
  for (const key of Object.keys(el)) {
    if (key.startsWith("__reactFiber$")) return (el as unknown as Record<string, Fiber>)[key] ?? null;
  }
  return null;
}

function nearestFiber(el: Element): Fiber | null {
  for (let cur: Element | null = el; cur; cur = cur.parentElement) {
    const fiber = fiberOf(cur);
    if (fiber) return fiber;
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

/** Component names from the fiber, outermost first. A fiber that cannot be read gives no names. */
function componentNames(el: Element): string[] {
  const names: string[] = [];
  try {
    for (let fiber = nearestFiber(el); fiber; fiber = fiber.return ?? null) {
      const name = componentName(fiber.type);
      if (name) names.push(name);
    }
  } catch {
    return [];
  }
  return names.reverse();
}

/**
 * Two layers, each works without the other. The source attribute gives the file and line
 * (set by the dev plugin). The React fiber gives component names (React 18 and earlier keep
 * function names; React 19 gives no source location on the fiber, so the attribute is the reliable path).
 */
export function readSourceInfo(el: Element): SourceInfo {
  const source = nearestSource(el);
  const names = componentNames(el);
  const info: SourceInfo = { confidence: source ? "source" : names.length ? "component" : "text" };
  if (names.length) info.component = names;
  if (source) info.source = source;
  return info;
}
