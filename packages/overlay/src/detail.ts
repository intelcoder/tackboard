// What the agent is told about an element beyond its markup: how it renders, how it differs from like siblings, and a tree of
// its children. Compact on purpose (numbers, no prose, defaults and inherited values left out) and redacted before it leaves the page.
import { LIMITS, redactText, SECRET_ATTR, stripQuery } from "@app/shared";

type Read = (prop: string) => string;

const px = (v: string) => v.replace(/(-?\d*\.?\d+)px/g, (_, n: string) => String(Math.round(parseFloat(n) * 10) / 10));

/** rgb() and rgba() as hex; fully transparent as "transparent"; anything else as it came. */
export function hex(color: string): string {
  const m = /^rgba?\(\s*(\d+)[ ,]+(\d+)[ ,]+(\d+)(?:[ ,/]+([\d.]+%?))?\s*\)$/.exec(color.trim());
  if (!m) return color.trim();
  const a = m[4] === undefined ? 1 : m[4].endsWith("%") ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
  if (a === 0) return "transparent";
  const h = [m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, "0")).join("");
  return `#${h}${a < 1 ? Math.round(a * 255).toString(16).padStart(2, "0") : ""}`;
}

/** Four sides as the shortest CSS shorthand; empty when every side is 0. */
export function box4(t: string, r: string, b: string, l: string): string {
  const z = (v: string) => v === "0" || v === "";
  if (z(t) && z(r) && z(b) && z(l)) return "";
  if (t === r && r === b && b === l) return t;
  if (t === b && r === l) return `${t} ${r}`;
  return `${t} ${r} ${b} ${l}`;
}

const ZERO = new Set(["", "0", "0px", "normal", "none", "auto"]);

/** The values worth telling an agent about, by name. `parent` is what the parent has, for values that are inherited. */
export function styleTokens(read: Read, parent: Read | null, background: string): Record<string, string> {
  const t: Record<string, string> = {};
  const set = (k: string, v: string) => { if (!ZERO.has(v)) t[k] = v; };
  t["font-size"] = px(read("font-size"));
  t.color = hex(read("color"));
  t.bg = background;
  t.display = read("display");
  const side = (name: string, s: string) => px(read(`${name}-${s}`));
  set("margin", box4(side("margin", "top"), side("margin", "right"), side("margin", "bottom"), side("margin", "left")));
  set("padding", box4(side("padding", "top"), side("padding", "right"), side("padding", "bottom"), side("padding", "left")));
  if (read("border-top-style") !== "none" && px(read("border-top-width")) !== "0") {
    t.border = `${px(read("border-top-width"))} ${read("border-top-style")} ${hex(read("border-top-color"))}`;
  }
  set("radius", px(read("border-top-left-radius")));
  const weight = read("font-weight");
  if (weight !== "400" && weight !== parent?.("font-weight")) t.weight = weight;
  const family = read("font-family").split(",")[0]!.replace(/["']/g, "").trim();
  if (family && family !== parent?.("font-family").split(",")[0]!.replace(/["']/g, "").trim()) t.font = family;
  const lh = read("line-height");
  if (lh !== "normal" && lh !== parent?.("line-height")) t["line-height"] = px(lh);
  const position = read("position");
  if (position !== "static") t.position = position;
  const row = px(read("row-gap")), col = px(read("column-gap"));
  set("gap", row === col ? row : `${row} ${col}`);
  if (/flex/.test(t.display)) {
    set("direction", read("flex-direction") === "row" ? "" : read("flex-direction"));
    const justify = read("justify-content");
    if (justify !== "normal" && justify !== "flex-start") t.justify = justify;
    const align = read("align-items");
    if (align !== "normal" && align !== "stretch") t.align = align;
  }
  if (t.display === "grid" || t.display === "inline-grid") {
    const cols = read("grid-template-columns");
    if (cols && cols !== "none") t.cols = String(cols.split(/\s+/).length);
  }
  const z = read("z-index");
  if (z !== "auto") t.z = z;
  const opacity = read("opacity");
  if (opacity !== "1") t.opacity = opacity;
  return t;
}

const label = (el: Element): string => {
  const first = (el.getAttribute("class") ?? "").split(/\s+/).find(Boolean);
  return `${el.localName}${el.id ? `#${el.id}` : first ? `.${first}` : ""}`;
};

/** Like siblings: same tag and same first class, the element itself left out. */
function likeSiblings(el: Element): Element[] {
  const first = (e: Element) => (e.getAttribute("class") ?? "").split(/\s+/).find(Boolean) ?? "";
  return [...(el.parentElement?.children ?? [])].filter((s) => s !== el && s.localName === el.localName && first(s) === first(el)).slice(0, 5);
}

const mode = (values: string[]): string => {
  const count = new Map<string, number>();
  for (const v of values) count.set(v, (count.get(v) ?? 0) + 1);
  return [...count.entries()].sort((a, b) => b[1] - a[1])[0]![0];
};

/** What this element has that its like siblings do not, as `name value (siblings value)`; null when it has no like siblings. */
export function siblingDiff(self: Record<string, string>, others: Record<string, string>[]): string[] | null {
  if (!others.length) return null;
  const out: string[] = [];
  for (const key of new Set([...Object.keys(self), ...others.flatMap((o) => Object.keys(o))])) {
    const mine = self[key] ?? "none";
    const theirs = mode(others.map((o) => o[key] ?? "none"));
    if (mine !== theirs) out.push(`${key} ${mine} (siblings ${theirs})`);
  }
  return out;
}

const ATTRS = ["href", "src", "type", "role", "aria-label", "alt", "placeholder", "name", "for", "target"];
const FLAGS = ["disabled", "checked", "hidden", "required", "readonly"];

/** The attributes of an element that change what it is or does, as `[href=/order.html type=submit disabled]`. Values are cut short and lose their query string. */
export function attrBits(el: Element): string {
  const bits = ATTRS.flatMap((a) => {
    const v = el.getAttribute(a);
    return v ? [`${a}=${stripQuery(v).replace(/^https?:\/\/[^/]+/, "").slice(0, 30)}`] : [];
  });
  for (const f of FLAGS) if (el.hasAttribute(f)) bits.push(f);
  return bits.length ? ` [${bits.join(" ")}]` : "";
}

const cleanLabel = (el: Element): string => {
  const classes = (el.getAttribute("class") ?? "").split(/\s+/).filter(Boolean).slice(0, 3).map((c) => `.${c}`).join("");
  const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => (n as Text).data).join(" ").replace(/\s+/g, " ").trim();
  return `${el.localName}${el.id ? `#${el.id}` : ""}${classes}${attrBits(el)}${own ? ` "${own.slice(0, 30)}${own.length > 30 ? "…" : ""}"` : ""}`;
};

/** The element and its children as an indented outline, three levels deep and at most 14 nodes; a cut says how many were left out. */
export function treeOf(root: Element): string[] {
  const lines = [cleanLabel(root)];
  let budget = 13;
  const walk = (el: Element, prefix: string, depth: number) => {
    const kids = [...el.children].filter((c) => !/^(script|style|noscript)$/i.test(c.localName));
    kids.forEach((kid, i) => {
      const last = i === kids.length - 1;
      if (budget <= 0) {
        if (i === 0 || budget === 0) {
          lines.push(`${prefix}${last ? "└" : "├"} … +${kids.length - i} more`);
          budget = -1;
        }
        return;
      }
      budget--;
      lines.push(`${prefix}${last ? "└" : "├"} ${cleanLabel(kid)}`);
      if (depth < 3) walk(kid, `${prefix}${last ? "  " : "│ "}`, depth + 1);
    });
  };
  walk(root, "", 1);
  return lines;
}

function effectiveBackground(el: Element, win: Window): string {
  for (let cur: Element | null = el; cur; cur = cur.parentElement) {
    const c = hex(win.getComputedStyle(cur).backgroundColor);
    if (c !== "transparent") return c;
  }
  return "transparent";
}

const reader = (el: Element, win: Window): Read => {
  const s = win.getComputedStyle(el);
  return (prop) => s.getPropertyValue(prop);
};

/** Redacted, compact description of how the element renders. Empty when the page gives no styles. */
export function describeElement(el: Element, win: Window): string {
  const read = reader(el, win);
  const parent = el.parentElement;
  const readParent = parent ? reader(parent, win) : null;
  const mine = styleTokens(read, readParent, effectiveBackground(el, win));
  const rect = el.getBoundingClientRect();
  const inherited = (k: "font-size" | "color") => (readParent && (k === "color" ? hex(readParent("color")) : px(readParent("font-size"))) === mine[k] ? " (inherited)" : "");
  const parts = [
    `font-size ${mine["font-size"]}${inherited("font-size")}`,
    `color ${mine.color}${inherited("color")}`,
    `bg ${mine.bg}`,
    `display ${mine.display}`,
    ...Object.entries(mine).filter(([k]) => !["font-size", "color", "bg", "display"].includes(k)).map(([k, v]) => `${k} ${v}`),
  ];
  const lines = [`rendered: ${parts.join(" · ")}`];

  if (parent) {
    const pt = styleTokens(readParent!, null, "transparent");
    const layout = pt.display === "grid" || pt.display === "inline-grid" ? `grid ${pt.cols ?? "?"} cols${pt.gap ? ` gap ${pt.gap}` : ""}`
      : /flex/.test(pt.display ?? "") ? `flex ${pt.direction ?? "row"}${pt.gap ? ` gap ${pt.gap}` : ""}` : (pt.display ?? "");
    const path: string[] = [];
    for (let cur: Element | null = parent; cur && path.length < 3; cur = cur.parentElement) path.unshift(label(cur));
    lines.push(`layout: parent ${label(parent)} ${layout} · path ${path.join(" > ")}`);
  }

  const like = likeSiblings(el);
  const others = like.map((s) => {
    const r = s.getBoundingClientRect();
    return { ...styleTokens(reader(s, win), readerOf(s.parentElement, win), effectiveBackground(s, win)), width: String(Math.round(r.width)), height: String(Math.round(r.height)) };
  });
  const diff = siblingDiff({ ...mine, width: String(Math.round(rect.width)), height: String(Math.round(rect.height)) }, others);
  lines.push(diff === null ? "siblings: no similar siblings" : diff.length ? `vs ${like.length} similar sibling${like.length > 1 ? "s" : ""}: ${diff.join(" · ")}` : `siblings: same as ${like.length} similar`);

  if (el.children.length) lines.push("tree:", ...treeOf(el).map((l) => `  ${l}`));
  return redactText(lines.join("\n")).slice(0, LIMITS.detail);
}

function readerOf(el: Element | null, win: Window): Read | null {
  return el ? reader(el, win) : null;
}

const BUTTONLIKE = /^(button|submit|reset|checkbox|radio|image)$/i;

/**
 * The element's markup with personal data and credentials taken out: what people typed (value attributes, textarea text),
 * credential-like attributes, query strings, data: addresses, and emails, numbers and tokens in text and attributes.
 */
export function safeHtml(el: Element): string {
  const clone = el.cloneNode(true) as Element;
  const nodes = [clone, ...clone.querySelectorAll("*")];
  for (const n of nodes) {
    const tag = n.localName;
    if (tag === "input" && !BUTTONLIKE.test(n.getAttribute("type") ?? "text")) n.removeAttribute("value");
    if (tag === "textarea" && n.textContent) n.textContent = "[input]";
    if (tag === "option" || tag === "select") n.removeAttribute("selected");
    for (const attr of [...n.attributes]) {
      const { name, value } = attr;
      if (name === "class" || name === "id" || name === "style" || name === "data-tb-src") continue;
      if (SECRET_ATTR.test(name)) n.setAttribute(name, "[redacted]");
      else if (/^data:/i.test(value)) n.setAttribute(name, `data:…(${value.length} chars)`);
      else if (/^(href|src|action|srcset|poster|formaction)$/i.test(name)) n.setAttribute(name, redactText(stripQuery(value)));
      else n.setAttribute(name, redactText(value));
    }
    for (const child of [...n.childNodes]) if (child.nodeType === 3) (child as Text).data = redactText((child as Text).data);
  }
  return clone.outerHTML;
}
