// Rebuilds the unpacked extension when its source changes and tells Chrome to reload it.
// Load packages/extension/dist once with "Load unpacked"; after that, save a file and the extension and the open local tabs update by themselves.
import { appendFileSync, watch } from "node:fs";
import { createServer, type ServerResponse } from "node:http";
import { join } from "node:path";
import { buildExtension } from "../packages/extension/build.ts";

const PORT = 35729;
const root = join(import.meta.dirname, "..");
const dist = join(root, "packages/extension/dist");

// Added to the background script of this dev build only. The service worker stays awake while the stream is open (the server sends a line every 20 s).
const devClient = `
;(() => {
  const c = chrome;
  c.storage.local.get("devReload").then(async ({ devReload }) => {
    if (!devReload) return;
    await c.storage.local.remove("devReload");
    for (const tab of await c.tabs.query({ url: ["http://localhost/*", "http://127.0.0.1/*", "file:///*"] })) c.tabs.reload(tab.id);
  });
  (async function listen() {
    try {
      const res = await fetch("http://127.0.0.1:${PORT}/events");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (decoder.decode(value).includes("reload")) {
          await c.storage.local.set({ devReload: true });
          c.runtime.reload();
        }
      }
    } catch {}
    setTimeout(listen, 1000);
  })();
})();
`;

async function build(): Promise<void> {
  await buildExtension(dist);
  appendFileSync(join(dist, "background.js"), devClient);
}

const listeners = new Set<ServerResponse>();
createServer((req, res) => {
  if (req.url !== "/events") return void res.writeHead(404).end();
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  res.write(": hello\n\n");
  listeners.add(res);
  req.on("close", () => listeners.delete(res));
}).listen(PORT, "127.0.0.1");
setInterval(() => listeners.forEach((res) => res.write(": ping\n\n")), 20_000);

await build();
console.log(`built ${dist}\nwatching; Chrome reloads the extension on every save`);

let timer: NodeJS.Timeout | undefined;
for (const dir of ["extension", "overlay", "shared"]) {
  watch(join(root, "packages", dir, "src"), { recursive: true }, () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      try {
        await build();
        listeners.forEach((res) => res.write("data: reload\n\n"));
        console.log(new Date().toLocaleTimeString(), "reloaded");
      } catch (error) {
        console.error("build failed:", (error as Error).message);
      }
    }, 150);
  });
}
