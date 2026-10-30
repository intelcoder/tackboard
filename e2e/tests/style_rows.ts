import type { StateName } from "../fixtures/states.ts";

export type StyleRow = {
  id: string;
  /** A name from `reach` in states.ts. */
  state: StateName;
  /** CSS inside the Shadow root. */
  selector: string;
  width: number;
  scheme: "light" | "dark";
  reducedMotion?: boolean;
  prop: string;
  /** A literal `rgb(...)` or size, or the name of a token read from the host at run time. */
  expected: string | { cssVar: string };
  /** CSS that changes the property away from the expected value. Every declaration ends in !important. */
  breakCss: string;
};

const PILL = "rgb(35, 38, 44)";
const PRESSED_TEXT = "rgb(122, 165, 255)";
const PRESSED_BACK = "rgb(54, 59, 69)";
const DARK_PANEL = "rgb(23, 28, 37)";
const WRONG = "rgb(1, 2, 3)";

type Spec = Pick<StyleRow, "id" | "state" | "selector" | "prop" | "expected" | "breakCss"> & Partial<StyleRow>;
const row = (spec: Spec): StyleRow => ({ width: 1280, scheme: "light", ...spec });
const css = (selector: string, prop: string, value: string) => `${selector}{${prop}:${value}!important}`;

const pill = ".tb-modes";
const pressed = '.tb-modes button[aria-pressed="true"]';
const modeButton = '.tb-modes button[data-mode="view"]';
const panel = ".tb-panel";
const outline = ".tb-outline";
const tag = ".tb-outline-tag";
const pin = ".tb-pin";
const chip = ".tb-thread .tb-chip";

export const rows: StyleRow[] = [
  row({ id: "R01", state: "view", selector: pill, prop: "background-color", expected: PILL, breakCss: css(pill, "background-color", WRONG) }),
  row({ id: "R02", state: "view", selector: pill, prop: "border-radius", expected: "12px", breakCss: css(pill, "border-radius", "0px") }),
  row({ id: "R03", state: "view", selector: pill, prop: "padding", expected: "5px", breakCss: css(pill, "padding", "12px") }),
  row({ id: "R04", state: "view", selector: modeButton, width: 320, prop: "width", expected: "40px", breakCss: css(modeButton, "width", "60px") }),
  row({ id: "R05", state: "commentMode", selector: pressed, prop: "color", expected: PRESSED_TEXT, breakCss: css(pressed, "color", WRONG) }),
  row({ id: "R06", state: "commentMode", selector: pressed, prop: "background-color", expected: PRESSED_BACK, breakCss: css(pressed, "background-color", WRONG) }),
  row({ id: "R07", state: "waitingClosed", selector: ".badge", prop: "background-color", expected: { cssVar: "--st-waiting" }, breakCss: css(".badge", "background-color", WRONG) }),
  row({ id: "R08", state: "waitingOpen", selector: ".badge", prop: "display", expected: "none", breakCss: css(".badge", "display", "grid") }),
  row({ id: "R09", state: "hoverCta", selector: outline, prop: "border-top-color", expected: { cssVar: "--tb-accent" }, breakCss: css(outline, "border-top-color", WRONG) }),
  row({ id: "R10", state: "hoverCta", selector: outline, prop: "border-top-width", expected: "2px", breakCss: css(outline, "border-top-width", "6px") }),
  row({ id: "R11", state: "hoverCta", selector: tag, prop: "background-color", expected: { cssVar: "--tb-accent" }, breakCss: css(tag, "background-color", WRONG) }),
  row({ id: "R12", state: "hoverCta", selector: tag, prop: "font-size", expected: "11px", breakCss: css(tag, "font-size", "20px") }),
  row({ id: "R13", state: "hoverCta", selector: ".tb-crumbs", prop: "background-color", expected: PILL, breakCss: css(".tb-crumbs", "background-color", WRONG) }),
  row({ id: "R14", state: "hoverCta", selector: ".tb-crumbs button.on", prop: "color", expected: PRESSED_TEXT, breakCss: css(".tb-crumbs button.on", "color", WRONG) }),
  row({ id: "R15", state: "pendingThread", selector: pin, prop: "width", expected: "22px", breakCss: css(pin, "width", "40px") }),
  row({ id: "R16", state: "pendingThread", selector: pin, prop: "background-color", expected: { cssVar: "--tb-accent" }, breakCss: css(pin, "background-color", WRONG) }),
  row({ id: "R17", state: "waitingThread", selector: pin, prop: "background-color", expected: { cssVar: "--st-waiting" }, breakCss: css(pin, "background-color", WRONG) }),
  row({ id: "R18", state: "resolvedThread", selector: pin, prop: "background-color", expected: { cssVar: "--st-resolved" }, breakCss: css(pin, "background-color", WRONG) }),
  row({ id: "R19", state: "pulsingPin", selector: pin, prop: "animation-name", expected: "tbpulse", breakCss: css(pin, "animation", "none") }),
  row({ id: "R20", state: "panelOpen", selector: chip, prop: "color", expected: { cssVar: "--st-pending" }, breakCss: css(chip, "color", WRONG) }),
  row({ id: "R21", state: "receivedThread", selector: chip, prop: "background-color", expected: { cssVar: "--st-received-bg" }, breakCss: css(chip, "background-color", WRONG) }),
  row({ id: "R22", state: "waitingOpen", selector: chip, prop: "color", expected: { cssVar: "--st-waiting" }, breakCss: css(chip, "color", WRONG) }),
  row({ id: "R23", state: "resolvedThread", selector: chip, prop: "color", expected: { cssVar: "--st-resolved" }, breakCss: css(chip, "color", WRONG) }),
  row({ id: "R24", state: "panelOpen", selector: panel, width: 320, prop: "width", expected: "292px", breakCss: css(panel, "width", "400px") }),
  row({ id: "R25", state: "panelOpen", selector: panel, width: 390, prop: "width", expected: "362px", breakCss: css(panel, "width", "400px") }),
  row({ id: "R26", state: "panelOpen", selector: panel, prop: "width", expected: "420px", breakCss: css(panel, "width", "400px") }),
  row({ id: "R27", state: "panelOpen", selector: panel, prop: "border-radius", expected: "10px", breakCss: css(panel, "border-radius", "0px") }),
  row({ id: "R28", state: "panelOpen", selector: panel, prop: "background-color", expected: { cssVar: "--tb-bg" }, breakCss: css(panel, "background-color", WRONG) }),
  row({ id: "R29", state: "panelOpen", selector: panel, prop: "border-top-color", expected: { cssVar: "--tb-line" }, breakCss: css(panel, "border-top-color", WRONG) }),
  row({ id: "R30", state: "panelOpen", selector: ".tb-tabs button.on", prop: "border-bottom-color", expected: { cssVar: "--tb-accent" }, breakCss: css(".tb-tabs button.on", "border-bottom-color", WRONG) }),
  row({ id: "R31", state: "conversation", selector: ".tb-msg.me .text", prop: "background-color", expected: { cssVar: "--tb-soft" }, breakCss: css(".tb-msg.me .text", "background-color", WRONG) }),
  row({ id: "R32", state: "conversation", selector: ".tb-msg.agent .text", prop: "background-color", expected: { cssVar: "--agent-bg" }, breakCss: css(".tb-msg.agent .text", "background-color", WRONG) }),
  row({ id: "R33", state: "composerOpen", selector: '[data-key="draft"]', prop: "background-color", expected: { cssVar: "--tb-accent" }, breakCss: css('[data-key="draft"]', "background-color", WRONG) }),
  // In this state the thread is claimed, so Rewind is blocked and wears the grey disabled look.
  row({ id: "R34", state: "restoreConfirm", selector: ".tb-confirm .tb-btn.danger", prop: "background-color", expected: { cssVar: "--tb-soft" }, breakCss: css(".tb-confirm .tb-btn.danger", "background-color", WRONG) }),
  row({ id: "R35", state: "notificationsDenied", selector: ".tb-banner.blocked", prop: "background-color", expected: { cssVar: "--st-waiting-bg" }, breakCss: css(".tb-banner.blocked", "background-color", WRONG) }),
  row({ id: "R36", state: "historyView", selector: ".tb-msg.tb-discarded", prop: "opacity", expected: "0.55", breakCss: css(".tb-msg.tb-discarded", "opacity", "1") }),
  row({ id: "R37", state: "panelOpen", selector: panel, scheme: "dark", prop: "background-color", expected: DARK_PANEL, breakCss: css(panel, "background-color", WRONG) }),
  row({ id: "R38", state: "pulsingPin", selector: pin, reducedMotion: true, prop: "animation-name", expected: "none", breakCss: `${pin}.pulse{animation:tbpulse .9s ease-out 2!important}` }),
  row({ id: "R39", state: "restoreConfirm", selector: ".tb-confirm .tb-btn.danger", prop: "color", expected: { cssVar: "--tb-muted" }, breakCss: css(".tb-confirm .tb-btn.danger", "color", WRONG) }),
];
