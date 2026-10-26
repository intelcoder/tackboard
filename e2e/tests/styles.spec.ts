import type { Page } from "@playwright/test";
import { brand } from "../../packages/shared/src/brand.ts";
import { test, expect } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";
import { reach } from "../fixtures/states.ts";
import { rows } from "./style_rows.ts";
import type { StyleRow } from "./style_rows.ts";

type Look = { before: string; broken: string; after: string; want: string };

async function reachRow(h: Harness, row: StyleRow): Promise<void> {
  await h.page.setViewportSize({ width: row.width, height: 800 });
  await h.page.emulateMedia({ colorScheme: row.scheme, reducedMotion: row.reducedMotion ? "reduce" : "no-preference" });
  await reach[row.state](h);
}

/**
 * Reads the property, then reads it again with the break rule added, then again with it removed.
 * All three reads happen in one call so a short animation cannot run out between them.
 */
function look(page: Page, row: StyleRow): Promise<Look> {
  return page.evaluate(
    ({ hostId, selector, prop, expected, breakCss }) => {
      const root = document.getElementById(hostId)!.shadowRoot!;
      const host = root.host as HTMLElement;
      const read = () => {
        const el = root.querySelector(selector);
        if (!el) throw new Error(`nothing matches ${selector}`);
        return getComputedStyle(el).getPropertyValue(prop);
      };
      // A token is turned into a colour by a probe element, so both sides are in the same rgb(...) form.
      const want = (() => {
        if (typeof expected === "string") return expected;
        const token = getComputedStyle(host).getPropertyValue(expected.cssVar).trim();
        if (!token) throw new Error(`${expected.cssVar} is not set on the host`);
        const probe = document.createElement("div");
        probe.style.color = token;
        root.append(probe);
        const colour = getComputedStyle(probe).color;
        probe.remove();
        return colour;
      })();
      const before = read();
      const style = document.createElement("style");
      style.textContent = breakCss;
      root.append(style);
      const broken = read();
      style.remove();
      return { before, broken, after: read(), want };
    },
    { hostId: brand.hostId, selector: row.selector, prop: row.prop, expected: row.expected, breakCss: row.breakCss },
  );
}

for (const row of rows) {
  test(`${row.id} holds`, async ({ harness: h }) => {
    await reachRow(h, row);
    const seen = await look(h.page, row);
    expect(seen.before, `${row.id} ${row.selector} ${row.prop}`).toBe(seen.want);
  });

  test(`${row.id} fails when broken`, async ({ harness: h }) => {
    await reachRow(h, row);
    const seen = await look(h.page, row);
    expect(seen.before).toBe(seen.want);
    expect(seen.broken, "the check must see the broken style").not.toBe(seen.want);
    expect(seen.after, "it holds again once the break is removed").toBe(seen.want);
  });
}
