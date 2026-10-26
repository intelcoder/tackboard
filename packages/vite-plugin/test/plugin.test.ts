import { test } from "node:test";
import assert from "node:assert/strict";
import { brand } from "@app/shared";
import { addSourceAttrs, sourceAttrPlugin } from "../src/index.ts";

const A = brand.sourceAttr;

test("addSourceAttrs adds the attribute with the right line to host tags", () => {
  const code = `export const x = (\n  <div>\n    <button onClick={go}>Go</button>\n  </div>\n);\n`;
  const out = addSourceAttrs(code, "src/x.tsx");
  assert.ok(out.includes(`<div ${A}="src/x.tsx:2">`), out);
  assert.ok(out.includes(`<button ${A}="src/x.tsx:3" onClick={go}>`), out);
});

test("addSourceAttrs leaves uppercase components, generics and i<n comparisons alone", () => {
  const code = [
    `const [a, b] = useState<string>("");`,
    `for (let i=0;i<n;i++) {}`,
    `if (i < n && a<b) {}`,
    `const id = <T,>(x: T) => x;`,
    `const k = <const T,>(x: T) => x;`,
    `const m: Map<string, Array<number>> = new Map();`,
    `const v = <PlanCard title="x" />;`,
    `const w = <Foo.Bar />;`,
  ].join("\n");
  assert.equal(addSourceAttrs(code, "a.tsx"), code);
});

test("addSourceAttrs handles multi-line tags, self-closing tags, nesting and text before a tag", () => {
  const code = `const a = (\n  <section\n    className="c"\n    id="s"\n  >\n    <img src={u} />\n    <input\n      disabled\n    />\n    Hello <b>there</b>\n  </section>\n);`;
  const out = addSourceAttrs(code, "p.tsx");
  assert.ok(out.includes(`<section ${A}="p.tsx:2"\n    className="c"`), out);
  assert.ok(out.includes(`<img ${A}="p.tsx:6" src={u} />`), out);
  assert.ok(out.includes(`<input ${A}="p.tsx:7"\n`), out);
  assert.ok(out.includes(`<b ${A}="p.tsx:10">there</b>`), out);
});

test("addSourceAttrs does not touch fragments or closing tags and skips tags that already have the attribute", () => {
  const code = `const a = (<><span ${A}="old:1">x</span><Card /></>);`;
  assert.equal(addSourceAttrs(code, "p.tsx"), code);
  const out = addSourceAttrs(`const a = (<>\n<p>t</p></>);`, "p.tsx");
  assert.equal(out, `const a = (<>\n<p ${A}="p.tsx:2">t</p></>);`);
});

test("addSourceAttrs ignores tags inside strings, template text and comments, but not tags after them", () => {
  const code = [
    `const s = "<div>";`,
    `const t = '<span class="x">';`,
    "const u = `<p>${a}</p>`;",
    `// <div> in a comment`,
    `/* <div>\n still comment */`,
    `const r = <em>don't</em>;`,
  ].join("\n");
  const out = addSourceAttrs(code, "q.tsx");
  assert.ok(out.includes(`const s = "<div>";`), out);
  assert.ok(out.includes(`const t = '<span class="x">';`), out);
  assert.ok(out.includes("const u = `<p>${a}</p>`;"), out);
  assert.ok(out.includes(`// <div> in a comment`), out);
  assert.ok(out.includes(`/* <div>\n still comment */`), out);
  assert.ok(out.includes(`<em ${A}="q.tsx:7">don't</em>`), out);
});

test("addSourceAttrs counts lines past strings and comments that span lines", () => {
  const code = "const a = `one\ntwo`;\n/* x\ny */\nconst b = <div />;";
  assert.ok(addSourceAttrs(code, "z.tsx").includes(`<div ${A}="z.tsx:5" />`));
});

test("addSourceAttrs handles braces holding arrow functions and a > inside attribute values", () => {
  const code = `const a = <div title="a>b" onClick={() => go(x > 1)} />;`;
  const out = addSourceAttrs(code, "b.tsx");
  assert.equal(out, `const a = <div ${A}="b.tsx:1" title="a>b" onClick={() => go(x > 1)} />;`);
});

test("addSourceAttrs leaves input it does not understand unchanged", () => {
  for (const code of ["", "const a = 1;", "<div", `x = <div onClick={() => {`, `const a = <div title="open`, "\u0000<<<>>>"]) {
    assert.equal(addSourceAttrs(code, "u.tsx"), code);
  }
});

test("addSourceAttrs gives the same answer when run on its own output", () => {
  const once = addSourceAttrs(`const a = <div><p>x</p></div>;`, "r.tsx");
  assert.equal(addSourceAttrs(once, "r.tsx"), once);
});

test("the plugin has apply serve and returns null for build and non-JSX ids", () => {
  const plugin = sourceAttrPlugin();
  assert.equal(plugin.apply, "serve");
  assert.equal(plugin.enforce, "pre");
  assert.equal(typeof plugin.name, "string");
  const code = `const a = <div />;`;
  assert.equal(plugin.transform(code, "/proj/src/util.ts"), null);
  assert.equal(plugin.transform(code, "/proj/src/style.css"), null);
  assert.equal(plugin.transform(code, "/proj/node_modules/lib/x.jsx"), null);
  assert.equal(plugin.transform("const a = 1;", "/proj/src/a.tsx"), null);
});

test("the plugin output for a tsx file contains the attribute", () => {
  const plugin = sourceAttrPlugin();
  const id = `${process.cwd()}/src/PlanCard.tsx?v=123`;
  const result = plugin.transform(`export const A = () => (\n  <div>x</div>\n);`, id);
  assert.ok(result);
  assert.equal(result.map, null);
  assert.ok(result.code.includes(`<div ${A}="src/PlanCard.tsx:2">`), result.code);
  assert.ok(plugin.transform(`const a = <i />;`, `${process.cwd()}/x.jsx`)!.code.includes(`${A}="x.jsx:1"`));
});
