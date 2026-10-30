import { mountOverlay } from "@app/overlay";
import { chrome } from "./chrome_calls.ts";
import { messageFetch } from "./message_fetch.ts";
import { createOverlaySwitch } from "./overlay_switch.ts";

const send = (message: unknown) => chrome.runtime.sendMessage(message);

const overlay = createOverlaySwitch({
  document,
  isOn: () => send({ kind: "is_on" }),
  mount: () =>
    mountOverlay({
      config: { base: "", token: "", fetch: messageFetch(send) },
      screenshot: async () => {
        const answer = await send({ kind: "screenshot" });
        if (answer.error) throw new Error(answer.error);
        return answer.dataUrl;
      },
    }),
});

void overlay.refresh();
chrome.runtime.onMessage.addListener((message) => {
  if (message.kind === "changed") void overlay.refresh();
});
