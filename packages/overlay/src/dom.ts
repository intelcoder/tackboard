// The only way the overlay builds DOM. Text goes in through text nodes and
// setAttribute, never through any HTML-parsing sink (scripts/guard.ts enforces it).

const SVG_NS = "http://www.w3.org/2000/svg";
const SVG_TAGS = new Set(["svg", "path", "circle", "g", "line", "rect"]);

export type Child = Node | string | number | null | undefined | false;
export type Props = Record<string, unknown> | null | undefined;
export type H = <K extends string>(tag: K, props?: Props, ...children: Child[]) => HTMLElement;

/**
 * Props: a function under an `on*` key becomes a listener (`onclick` -> "click",
 * `onmouseenter` -> "mouseenter"); `true` sets an empty attribute; `false`, null and
 * undefined skip the attribute; anything else is stringified into the attribute.
 */
export function createH(doc: Document): H {
  return (tag, props, ...children) => {
    const el = (SVG_TAGS.has(tag) ? doc.createElementNS(SVG_NS, tag) : doc.createElement(tag)) as HTMLElement;
    for (const [key, value] of Object.entries(props ?? {})) {
      if (value === false || value == null) continue;
      if (key.startsWith("on") && typeof value === "function") {
        el.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
      } else {
        el.setAttribute(key, value === true ? "" : String(value));
      }
    }
    for (const c of children) {
      if (c === null || c === undefined || c === false) continue;
      el.append(typeof c === "object" ? c : doc.createTextNode(String(c)));
    }
    return el;
  };
}
