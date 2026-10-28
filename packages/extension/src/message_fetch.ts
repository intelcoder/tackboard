import type { Answer, CallMessage } from "./proxy.ts";

const aborted = () => new DOMException("The call was stopped", "AbortError");

/** A `fetch` for the overlay that asks the background script to make the call, so the page side never holds the token. */
export function messageFetch(send: (message: CallMessage) => Promise<Answer>): typeof fetch {
  return async (input, init) => {
    const signal = init?.signal;
    if (signal?.aborted) throw aborted();
    const stopped = new Promise<never>((_, fail) => signal?.addEventListener("abort", () => fail(aborted())));
    const answer = await Promise.race([
      send({ kind: "call", method: init?.method ?? "GET", path: String(input), body: init?.body as string | undefined }),
      stopped,
    ]);
    if ("error" in answer) throw new Error(answer.error);
    return new Response(answer.text, { status: answer.status });
  };
}
