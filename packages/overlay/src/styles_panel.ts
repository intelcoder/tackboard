// Panel styles, from the UI reference. Colours come from the tokens in styles_base.ts.
export const panelCss = `
/* the host resets inherited styles inline, so the font and colour are set on the layers themselves */
.tb-panel-layer,.tb-dock{font:13px/1.45 var(--body);color:var(--tb-fg)}
.tb-panel,.tb-toast{pointer-events:auto}

/* CommentsPanel */
.tb-panel{position:fixed;right:14px;bottom:78px;z-index:9;width:min(420px,calc(100vw - 28px));max-height:min(400px,calc(100vh - 100px));background:var(--tb-bg);border:1px solid var(--tb-line);border-radius:10px;box-shadow:0 8px 24px rgba(16,24,40,.18);display:flex;flex-direction:column;overflow:hidden}
.tb-panel[hidden]{display:none}
.tb-panel.drawer{top:0;right:0;bottom:68px;left:auto;width:min(460px,100vw);max-height:none;border-radius:0 0 0 10px;border-width:0 0 1px 1px}
.tb-panel.drawer .tb-head{cursor:default}
/* the panel clips and scrolls, so focus rings go inside the edge instead of outside it */
.tb-panel button:focus-visible,.tb-panel textarea:focus-visible{outline-offset:-2px}
.tb-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:12px 14px;border-bottom:1px solid var(--tb-line);cursor:grab;user-select:none;touch-action:none;flex:none}
.tb-head:active{cursor:grabbing}
.tb-head b{font:600 13px var(--display)}
.tb-title{display:flex;flex-direction:column;gap:2px;min-width:0}
.tb-title .tb-branch{align-self:flex-start;background:none;padding:0}
.tb-head-right{display:flex;gap:6px;align-items:center;min-width:0}
.tb-grip{color:var(--tb-muted);letter-spacing:-3px;font-size:13px;margin-right:4px}
.tb-x{border:0;background:none;color:var(--tb-muted);width:24px;height:24px;border-radius:5px;font-size:12px;padding:0;flex:none}
.tb-x:hover{background:var(--tb-soft);color:var(--tb-fg)}
.tb-branch{font:500 11px var(--mono);color:var(--tb-muted);background:var(--tb-soft);padding:2px 6px;border-radius:3px;max-width:130px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

/* AgentBadge */
.tb-agent{display:inline-flex;align-items:center;gap:6px;font:500 12px var(--mono);color:var(--agent);background:var(--agent-bg);padding:2px 8px 2px 6px;border-radius:10px;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tb-agent .dot{width:7px;height:7px;border-radius:50%;background:var(--agent);flex:none}
.tb-agent.off{color:var(--tb-muted);background:var(--tb-soft)}
.tb-agent.off .dot{background:transparent;border:1.5px solid var(--tb-muted)}

/* the draft count on the toolbar's comments button sits below the other badge */
.draft-count{position:absolute;bottom:2px;right:1px;min-width:16px;height:16px;border-radius:8px;background:#7c3aed;color:#fff;font:600 9.5px var(--mono);display:grid;place-items:center;padding:0 4px;border:2px solid #23262c;box-sizing:content-box}
.draft-count[hidden]{display:none}

/* tabs */
.tb-tabs{display:flex;gap:6px;padding:0 14px;border-bottom:1px solid var(--tb-line);flex:none}
.tb-tabs button{border:0;background:none;padding:8px 4px;color:var(--tb-muted);font-weight:500;border-bottom:2px solid transparent;margin-bottom:-1px}
.tb-tabs button i{font:500 10px var(--mono);font-style:normal;background:var(--tb-soft);padding:1px 6px;border-radius:8px;margin-left:4px}
.tb-tabs button.on{color:var(--tb-fg);border-bottom-color:var(--tb-accent)}
.tb-tabs button:hover{color:var(--tb-fg)}

.tb-list{overflow:auto;display:flex;flex-direction:column;min-height:0;flex:1 1 auto}
.tb-subhead{display:flex;align-items:center;gap:10px;padding:8px 14px;border-bottom:1px solid var(--tb-line);flex:none}
.tb-foot{padding:6px 14px;border-top:1px solid var(--tb-line);display:flex;justify-content:flex-end;flex:none}
.tb-link{border:0;background:none;color:var(--tb-accent);font:500 12px var(--body);padding:3px 4px;border-radius:4px}
.tb-link:hover{text-decoration:underline}

/* ThreadItem */
.tb-thread{padding:10px 14px;border-bottom:1px solid var(--tb-line);display:flex;flex-direction:column;gap:8px;min-width:0}
.tb-thread:hover{background:var(--tb-soft)}
.tb-thread.active{background:var(--tb-accent-soft)}
.tb-thread-top,.tb-preview{border:0;background:none;text-align:left;padding:0;width:100%;min-width:0;border-radius:4px}
.tb-thread-top{display:flex;align-items:center;gap:10px}
.tb-thread-top .tb-target{flex:1}
.tb-target{font:500 11px var(--mono);color:var(--tb-muted);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tb-num{width:20px;height:20px;border-radius:50%;background:var(--tb-accent);color:var(--tb-on-accent);font:600 10.5px var(--mono);display:grid;place-items:center;flex:none}
.tb-num[data-s="waiting"]{background:var(--st-waiting);color:#fff}
.tb-num[data-s="resolved"]{background:var(--st-resolved);color:#fff}
.tb-unread{width:8px;height:8px;border-radius:50%;background:var(--tb-accent);flex:none}
.tb-preview{color:var(--tb-muted);font-size:12.5px;display:-webkit-box;-webkit-line-clamp:1;-webkit-box-orient:vertical;overflow:hidden;padding-left:0;overflow-wrap:anywhere}
.tb-preview b{color:var(--tb-fg);font-weight:500}
.tb-note{padding-left:0;font:500 11px var(--mono);color:var(--st-waiting)}
.tb-section{padding:8px 14px 4px;font:500 11px var(--mono);color:var(--tb-muted);border-bottom:1px solid var(--tb-line)}

/* Message */
.tb-convo{display:flex;flex-direction:column;gap:8px;padding-left:0;min-width:0}
.tb-msg{display:flex;flex-direction:column;gap:2px;min-width:0}
.tb-msg .who{font:500 11px var(--mono);color:var(--agent)}
.tb-msg .text{white-space:pre-wrap;overflow-wrap:anywhere;padding:6px 10px;max-width:92%}
.tb-msg .md{white-space:normal}
.tb-msg .md p,.tb-msg .md ul,.tb-msg .md ol,.tb-msg .md pre{margin:0 0 6px}
.tb-msg .md>:last-child{margin-bottom:0}
.tb-msg .md ul,.tb-msg .md ol{padding-left:18px}
.tb-msg .md code{font:12px var(--mono);background:var(--tb-soft);padding:0 3px;border-radius:3px}
.tb-msg .md pre{overflow-x:auto;background:var(--tb-soft);padding:6px 8px;border-radius:6px;white-space:pre}
.tb-msg .md pre code{background:none;padding:0}
.tb-msg .md a{color:inherit;text-decoration:underline}
.tb-msg.me{align-items:flex-end}
.tb-msg.me .text{background:var(--tb-soft);border-radius:10px 10px 2px 10px}
.tb-msg.agent .text{max-width:100%;background:var(--agent-bg);border-radius:10px 10px 10px 2px}
.tb-msg.system{align-items:center;font-size:12px;color:var(--tb-muted)}
.tb-msg.system .text{max-width:100%;text-align:center}
.tb-discarded{opacity:.55}
.tb-msg.tb-discarded{align-items:flex-start}

.tb-reply{display:flex;gap:6px;padding-left:0;align-items:flex-end}
.tb-reply textarea{flex:1;min-width:0;border:1px solid var(--tb-line);border-radius:6px;padding:6px 9px;background:var(--tb-bg);color:var(--tb-fg);font:inherit;resize:vertical;min-height:32px;max-height:120px}
.tb-row.tb-actions{padding-left:0;justify-content:flex-start}

/* messages waiting to be sent: faded, with their status under them */
.tb-queued{display:flex;flex-direction:column;gap:2px;align-items:flex-start;min-width:0}
.tb-queued .text{white-space:pre-wrap;overflow-wrap:anywhere;padding:0 10px;border:solid var(--tb-soft);border-width:6px 0;max-width:92%;background:var(--tb-soft);border-radius:10px 10px 2px 10px;opacity:.55;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.tb-queued .tb-row{justify-content:flex-start}
.tb-thread .tb-queued{align-items:flex-end}
.tb-thread .tb-queued .tb-row{justify-content:flex-end}
.tb-queue{flex:none;border-bottom:1px solid var(--tb-line)}
.tb-queue .tb-queued{padding:6px 14px;border-bottom:1px solid var(--tb-line)}
.tb-queue .tb-queued:last-child{border-bottom:0}
.tb-queue>.tb-section.tb-row{flex-wrap:nowrap;justify-content:space-between;padding:6px 14px}
.tb-queue .tb-thread-top{width:auto;max-width:100%}
/* the drafts block is a card that stands apart from the thread list */
.tb-drafts{--dash:color-mix(in srgb,var(--tb-accent) 25%,var(--tb-bg));flex:none;margin:10px;border:1px dashed color-mix(in srgb,var(--tb-accent) 45%,var(--tb-bg));border-radius:8px;background:color-mix(in srgb,var(--tb-accent) 5%,var(--tb-bg))}
.tb-drafts .tb-section,.tb-drafts .tb-queued{border-bottom:1px dashed var(--dash)}
.tb-drafts .tb-queued .tb-btn{padding:1px 8px}
.tb-drafts-title{font:600 13px var(--body);color:var(--tb-fg)}
.tb-draft-top{display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%;min-width:0}
.tb-draft-top .tb-thread-top{flex:1}
.tb-drafts .tb-queued .text{opacity:1;background:none;border:0;border-radius:0;padding:0;max-width:100%;color:var(--tb-fg)}

/* Composer and RestoreConfirm */
.tb-attach{display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer}.tb-attach:has(:disabled){cursor:default;opacity:.7}.tb-composer{display:flex;flex-direction:column;gap:8px;padding:10px 12px;min-width:0;overflow:auto}
.tb-composer-top{display:flex;align-items:center;gap:6px;min-width:0}
.tb-composer .tb-composer-top .target{align-self:center}
.tb-composer-top .tb-hint{margin-left:auto;flex:none;white-space:nowrap}
.tb-composer .tb-row{padding-top:4px}
.tb-composer .target{font:500 11px var(--mono);color:var(--tb-accent);background:var(--tb-accent-soft);padding:2px 6px;border-radius:3px;align-self:flex-start;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tb-composer textarea{width:100%;min-height:64px;resize:vertical;border:1px solid var(--tb-line);border-radius:6px;padding:7px 9px;background:var(--tb-bg);color:var(--tb-fg);font:inherit}
.tb-confirm-title{font:600 13px var(--display)}
.tb-reason{color:var(--st-waiting)}
.tb-row{display:flex;gap:8px;justify-content:flex-end;align-items:center;flex-wrap:wrap}
.tb-row .tb-hint{margin-right:auto}
.tb-btn{border:1px solid var(--tb-line);background:var(--tb-bg);border-radius:6px;padding:5px 12px;font-weight:500}
.tb-btn:hover{border-color:var(--tb-accent);color:var(--tb-accent)}
.tb-btn.primary{background:var(--tb-accent);border-color:var(--tb-accent);color:var(--tb-on-accent)}
.tb-btn.primary:hover{filter:brightness(1.1);color:var(--tb-on-accent)}
.tb-btn.danger{background:var(--st-waiting);border-color:var(--st-waiting);color:#fff}
.tb-btn.danger:hover{filter:brightness(1.1);color:#fff}
.tb-btn:disabled{opacity:.45;cursor:not-allowed;filter:none}
.tb-btn.danger:disabled{opacity:1;background:var(--tb-soft);border-color:var(--tb-line);color:var(--tb-muted)}
.tb-hint{font-size:11px;color:var(--tb-muted)}

/* RestorePoint */
.tb-restore{display:flex;align-items:center;gap:8px;font:500 11px var(--mono);color:var(--tb-muted);padding:6px 8px;background:var(--tb-soft);border-radius:4px}
.tb-restore .line{flex:1;height:1px;background:var(--tb-line);min-width:0}
.tb-restore-label{display:flex;white-space:nowrap;min-width:0;overflow:hidden}
.tb-restore-label>span{flex:none}
.tb-restore-label>.tb-restore-hash{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis}
.tb-restore button{flex:none;white-space:nowrap;border:1px solid var(--tb-line);background:var(--tb-bg);border-radius:4px;padding:2px 8px;font:500 11px var(--mono)}
.tb-restore button:hover{border-color:var(--tb-accent);color:var(--tb-accent)}

/* PermissionBanner, error line, EmptyState */
.tb-banner{display:flex;gap:10px;align-items:center;justify-content:space-between;padding:8px 12px;background:var(--tb-accent-soft);font-size:12px;flex:none;overflow-wrap:anywhere}
.tb-banner.blocked{background:var(--st-waiting-bg);color:var(--tb-fg)}
.tb-banner.small{justify-content:flex-start;padding:4px 10px}
.tb-banner{flex-wrap:wrap}
.tb-banner .tb-btn{white-space:nowrap}
.tb-empty{padding:22px 16px;text-align:center;color:var(--tb-muted);font-size:12.5px;display:flex;flex-direction:column;gap:6px;align-items:center}
.tb-empty b{color:var(--tb-fg);font:600 13px var(--display)}

/* scroll link flash and Toast */
.tb-flash{position:fixed;pointer-events:none;outline:2px solid var(--tb-accent);outline-offset:3px;border-radius:3px;z-index:5}
.tb-toast{position:fixed;right:14px;top:14px;z-index:10;max-width:calc(100vw - 28px);display:inline-flex;gap:8px;align-items:center;background:var(--tb-fg);color:var(--tb-bg);padding:7px 12px;border-radius:7px;font-size:12px;box-shadow:0 4px 14px rgba(16,24,40,.3);overflow-wrap:anywhere}
`;
