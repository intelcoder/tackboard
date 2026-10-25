// THROWAWAY SPIKE overlay: modes hidden/view/comment, blue hover outline, click to comment, polls for replies.
(() => {
  const base = new URL(document.currentScript.src).origin;
  let mode = "view", threads = [], hovered = null;
  const host = document.createElement("div");
  host.style.cssText = "all:initial;position:fixed;z-index:2147483647;right:12px;bottom:12px;font:13px system-ui";
  const root = host.attachShadow({ mode: "open" });
  document.body.append(host);
  root.innerHTML = `<style>
    button{margin-right:4px;padding:4px 8px;cursor:pointer} .on{background:#2563eb;color:#fff}
    .box{background:#fff;color:#111;border:1px solid #ccc;padding:8px;margin-top:6px;width:280px;max-height:240px;overflow:auto}
    .st{color:#666} textarea{width:100%;box-sizing:border-box}
  </style><div id="bar"></div><div id="panel"></div>`;
  const bar = root.getElementById("bar"), panel = root.getElementById("panel");
  const outline = Object.assign(document.createElement("div"), {});
  outline.style.cssText = "position:fixed;pointer-events:none;border:2px solid #2563eb;background:rgba(37,99,235,.1);z-index:2147483646;display:none";
  document.body.append(outline);
  const pins = document.createElement("div"); document.body.append(pins);

  const selectorOf = (el) => { // ponytail: naive path selector, breaks on re-render; real build adds text fallback
    const parts = [];
    for (; el && el !== document.body; el = el.parentElement) {
      const i = [...el.parentElement.children].indexOf(el) + 1;
      parts.unshift(`${el.tagName.toLowerCase()}:nth-child(${i})`);
    }
    return "body > " + parts.join(" > ");
  };
  const setMode = (m) => { mode = m; outline.style.display = "none"; render(); };
  const esc = (s) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c])); // replies are text only

  function render() {
    bar.innerHTML = ["hidden", "view", "comment"].map((m) => `<button data-m="${m}" class="${m === mode ? "on" : ""}">${m}</button>`).join("");
    bar.querySelectorAll("button").forEach((b) => (b.onclick = () => setMode(b.dataset.m)));
    pins.innerHTML = ""; if (mode === "hidden") { panel.innerHTML = ""; return; }
    threads.forEach((t, n) => {
      const el = document.querySelector(t.element.selector); if (!el) return;
      const r = el.getBoundingClientRect();
      const p = Object.assign(document.createElement("div"), { textContent: n + 1 });
      p.style.cssText = `position:fixed;left:${r.right - 10}px;top:${r.top - 10}px;background:#2563eb;color:#fff;border-radius:50%;width:20px;height:20px;text-align:center;line-height:20px;font:12px system-ui;z-index:2147483646`;
      pins.append(p);
    });
    panel.innerHTML = `<div class="box">${threads.map((t, n) => `<div><b>${n + 1}</b> <span class="st">[${t.status}]</span> on ${esc(t.element.selector.split(" > ").pop())}<br>${t.messages.map((m) => `${esc(m.from)}: ${esc(m.text)}`).join("<br>")}</div><hr>`).join("") || "no threads"}</div>`;
  }

  document.addEventListener("mousemove", (e) => {
    if (mode !== "comment" || e.composedPath().includes(host)) return outline.style.display = "none";
    hovered = e.target; const r = hovered.getBoundingClientRect();
    Object.assign(outline.style, { display: "block", left: r.left + "px", top: r.top + "px", width: r.width + "px", height: r.height + "px" });
  });
  document.addEventListener("click", (e) => {
    if (mode !== "comment" || e.composedPath().includes(host)) return;
    e.preventDefault(); e.stopPropagation();
    const el = e.target;
    panel.innerHTML = `<div class="box"><textarea rows="3" placeholder="Comment on this element"></textarea><button id="send">Send</button><button id="cancel">Cancel</button></div>`;
    panel.querySelector("#cancel").onclick = render;
    panel.querySelector("#send").onclick = async () => {
      const comment = panel.querySelector("textarea").value.trim(); if (!comment) return;
      await fetch(base + "/threads", { method: "POST", body: JSON.stringify({ selector: selectorOf(el), text: el.innerText?.slice(0, 120), html: el.outerHTML.slice(0, 400), url: location.href, comment }) });
      setMode("view"); poll();
    };
  }, true);

  async function poll() { // ponytail: polling, real build same in v1
    if (mode === "hidden") return;
    try { threads = await (await fetch(base + "/threads")).json(); } catch {}
    if (!panel.querySelector("textarea")) render();
  }
  render(); poll(); setInterval(poll, 2000);
})();
