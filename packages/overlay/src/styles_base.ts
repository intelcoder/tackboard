// Tokens and base rules, copied from the UI reference. They live on :host inside the
// Shadow root, so the overlay looks the same on any site. System font stacks only: the
// overlay never loads anything from the network.

const light = `
  --tb-bg:#ffffff; --tb-fg:#14181f; --tb-muted:#667085; --tb-line:#dfe3ea; --tb-soft:#f3f5f8;
  --tb-accent:#2563eb; --tb-accent-soft:#e6eefc; --tb-on-accent:#ffffff;
  --st-pending:#667085; --st-pending-bg:#eceff3;
  --st-received:#2563eb; --st-received-bg:#e6eefc;
  --st-waiting:#b45309; --st-waiting-bg:#fdf0dc;
  --st-resolved:#15803d; --st-resolved-bg:#e1f5e8;
  --agent:#0f766e; --agent-bg:#dff3f0;`;

const dark = `
  --tb-bg:#171c25; --tb-fg:#e7eaf0; --tb-muted:#97a1b2; --tb-line:#2b3444; --tb-soft:#1e2531;
  --tb-accent:#6b9bff; --tb-accent-soft:#1a2848; --tb-on-accent:#0b1220;
  --st-pending:#97a1b2; --st-pending-bg:#232b38;
  --st-received:#6b9bff; --st-received-bg:#1a2848;
  --st-waiting:#f0b45c; --st-waiting-bg:#33260f;
  --st-resolved:#5fd08a; --st-resolved-bg:#12301f;
  --agent:#4fd1c0; --agent-bg:#10302c;`;

export const baseCss = `
:host{${light}
  --display:system-ui,-apple-system,"Segoe UI","Helvetica Neue",Arial,sans-serif;
  --body:system-ui,-apple-system,"Segoe UI",sans-serif;
  --mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  font:13px/1.45 var(--body);color:var(--tb-fg);color-scheme:light dark}
@media (prefers-color-scheme:dark){:host{${dark}}}
*{box-sizing:border-box}
button{font:inherit;color:inherit;cursor:pointer}
button:focus-visible,textarea:focus-visible,input:focus-visible{outline:2px solid var(--tb-accent);outline-offset:2px}

/* children of the click-through host opt back in */
.tb-modes,.tb-crumbs,.tb-pin{pointer-events:auto}

/* ModeSwitch: a dark icon pill on purpose, so it reads the same on any site and in either theme */
.tb-dock{position:fixed;right:14px;bottom:14px;z-index:7}
.tb-modes{display:inline-flex;border-radius:12px;background:#23262c;padding:5px;gap:4px;box-shadow:0 4px 14px rgba(16,24,40,.3)}
.tb-modes button{position:relative;border:0;background:none;width:40px;height:40px;border-radius:8px;color:#aab0bb;display:grid;place-items:center;padding:0}
.tb-modes button:hover{background:#2f333b;color:#e6e9ef}
.tb-modes button[aria-pressed="true"]{background:#363b45;color:#7aa5ff}
.tb-modes button:focus-visible{outline-color:#7aa5ff}
.tb-modes button:disabled{opacity:.35;cursor:default}
.tb-modes button:disabled:hover{background:none;color:#aab0bb}
.tb-modes svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.tb-modes .div{width:1px;background:#3a3f49;margin:8px 3px}
.badge{position:absolute;top:2px;right:1px;min-width:16px;height:16px;border-radius:8px;background:var(--st-waiting);color:#fff;font:600 9.5px var(--mono);display:grid;place-items:center;padding:0 4px;border:2px solid #23262c;box-sizing:content-box}
.badge[hidden]{display:none}

/* HoverOutline */
.tb-outline{position:fixed;pointer-events:none;border:2px solid var(--tb-accent);background:color-mix(in srgb,var(--tb-accent) 10%,transparent);border-radius:2px;z-index:5}
.tb-outline-tag{position:absolute;left:-2px;top:-22px;background:var(--tb-accent);color:var(--tb-on-accent);font:500 11px var(--mono);padding:2px 6px;border-radius:3px 3px 0 0;white-space:nowrap}
.tb-outline-tag.below{top:auto;bottom:-22px;border-radius:0 0 3px 3px}

/* ElementPath */
.tb-crumbs{position:fixed;left:12px;bottom:12px;z-index:8;display:flex;flex-wrap:wrap;gap:2px;align-items:center;max-width:max(180px,calc(100vw - 300px));background:#23262c;border-radius:10px;padding:5px;font:500 11px var(--mono);color:#aab0bb;box-shadow:0 4px 14px rgba(16,24,40,.3)}
.tb-crumbs button{border:0;background:none;color:inherit;padding:4px 7px;border-radius:6px;font:inherit}
.tb-crumbs button:hover{background:#2f333b;color:#e6e9ef}
.tb-crumbs button.on{background:#363b45;color:#7aa5ff}
.tb-crumbs button:focus-visible{outline-color:#7aa5ff;outline-offset:-2px}
.tb-crumbs .sep{opacity:.45}
.tb-crumbs .hint{margin-left:8px;padding-right:6px;opacity:.7}
@media (max-width:640px){.tb-crumbs{bottom:76px;max-width:calc(100vw - 24px)}}

/* Pin */
.tb-pin{position:fixed;padding:0;width:22px;height:22px;border-radius:50% 50% 50% 2px;background:var(--tb-accent);color:var(--tb-on-accent);font:600 11px var(--mono);display:grid;place-items:center;border:2px solid var(--tb-bg);box-shadow:0 1px 3px rgba(16,24,40,.3);z-index:6}
.tb-pin:hover{filter:brightness(1.12);transform:scale(1.08)}
.tb-pin[data-status="waiting"]{background:var(--st-waiting);color:#fff}
.tb-pin[data-status="resolved"]{background:var(--st-resolved);color:#fff}
.tb-pin.pulse{animation:tbpulse .9s ease-out 2}
@keyframes tbpulse{0%{box-shadow:0 0 0 0 color-mix(in srgb,var(--tb-accent) 60%,transparent)}100%{box-shadow:0 0 0 14px transparent}}

/* StatusChip */
.tb-chip{display:inline-flex;align-items:center;gap:5px;font:500 11px var(--mono);padding:2px 7px;border-radius:10px;white-space:nowrap}
.tb-chip::before{content:"";width:6px;height:6px;border-radius:50%;background:currentColor}
.tb-chip[data-s="pending"]{color:var(--st-pending);background:var(--st-pending-bg)}
.tb-chip[data-s="received"]{color:var(--st-received);background:var(--st-received-bg)}
.tb-chip[data-s="waiting"]{color:var(--st-waiting);background:var(--st-waiting-bg)}
.tb-chip[data-s="resolved"]{color:var(--st-resolved);background:var(--st-resolved-bg)}
.tb-chip[data-s="discarded"]{color:var(--tb-muted);background:var(--tb-soft);text-decoration:line-through}

@media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}
`;
