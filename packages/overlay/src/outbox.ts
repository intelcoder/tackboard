// Messages the user has sent, waiting to reach the daemon. Kept in memory only: a reload loses them.
import { ApiError } from "./api.ts";

const TIMEOUT_MS = 8000;
const RETRY_MS = 3000;
const timedOut = Symbol("timed out");

export type OutboxItem<Job> = {
  job: Job;
  /** `retry` means the daemon could not be reached; `failed` means it needs the user. */
  state: "sending" | "retry" | "failed";
  /** Why a `failed` item was not sent. */
  reason: string;
};

type OutboxOptions<Job> = {
  send(job: Job, signal: AbortSignal): Promise<void>;
  onChange(): void;
};

/** Sends one job at a time, oldest first. A job that never answers is aborted after 8 seconds. */
export function createOutbox<Job>(o: OutboxOptions<Job>) {
  let items: OutboxItem<Job>[] = [];
  let busy = false;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let sending: AbortController | undefined;
  let inflight: OutboxItem<Job> | undefined;

  const first = () => items.find((i) => i.state !== "failed");

  const pump = async () => {
    const item = first();
    if (busy || !item || item.state === "retry") return;
    busy = true;
    inflight = item;
    const abort = new AbortController();
    sending = abort;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, giveUp) => {
      timer = setTimeout(() => {
        giveUp(timedOut);
        abort.abort();
      }, TIMEOUT_MS);
    });
    try {
      await Promise.race([o.send(item.job, abort.signal), timeout]);
      items = items.filter((i) => i !== item);
    } catch (e) {
      if (e === timedOut || e instanceof ApiError) {
        item.state = "failed";
        item.reason = e === timedOut ? "The daemon did not answer" : (e as ApiError).message;
      } else if (items.includes(item)) {
        item.state = "retry";
        retryTimer = setTimeout(tryAgain, RETRY_MS);
      }
    }
    clearTimeout(timer);
    busy = false;
    inflight = undefined;
    pump();
    o.onChange();
  };

  const tryAgain = () => {
    const item = first();
    if (item?.state === "retry") item.state = "sending";
    pump();
    o.onChange();
  };

  return {
    items: (): readonly OutboxItem<Job>[] => items,
    add(job: Job) {
      items = [...items, { job, state: "sending", reason: "" }];
      pump();
      o.onChange();
    },
    retry(item: OutboxItem<Job>) {
      item.state = "sending";
      pump();
      o.onChange();
    },
    /** True only while this item's request is on its way to the daemon. */
    inflight: (item: OutboxItem<Job>) => item === inflight,
    remove(item: OutboxItem<Job>) {
      items = items.filter((i) => i !== item);
      o.onChange();
    },
    /** Drops everything, aborts the request in flight and stops the retry timer, so a torn-down overlay sends nothing more. */
    destroy() {
      clearTimeout(retryTimer);
      sending?.abort();
      items = [];
    },
  };
}
