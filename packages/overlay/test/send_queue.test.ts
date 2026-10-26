import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { ApiError } from "../src/api.ts";
import { createSendQueue } from "../src/send_queue.ts";

// A send function the test controls: every call waits until the test settles it.
function fakeSend() {
  const calls: { job: string; signal: AbortSignal; ok(): void; fail(e: unknown): void }[] = [];
  const send = (job: string, signal: AbortSignal) =>
    new Promise<void>((ok, fail) => calls.push({ job, signal, ok, fail }));
  return { calls, send };
}

const settle = () => new Promise((done) => setImmediate(done));

function setup() {
  mock.timers.enable({ apis: ["setTimeout"] });
  const fake = fakeSend();
  const queue = createSendQueue<string>({ send: fake.send, onChange: () => {} });
  return { ...fake, queue };
}

test("messages are sent one at a time, oldest first", async (t) => {
  t.after(() => mock.timers.reset());
  const { calls, queue } = setup();
  queue.add("one");
  queue.add("two");
  await settle();
  assert.deepEqual(calls.map((c) => c.job), ["one"]);
  calls[0].ok();
  await settle();
  assert.deepEqual(calls.map((c) => c.job), ["one", "two"]);
  calls[1].ok();
  await settle();
  assert.deepEqual(queue.items(), []);
});

test("only the item whose request is in flight is sending; one behind a waiting item is not", async (t) => {
  t.after(() => mock.timers.reset());
  const { calls, queue } = setup();
  queue.add("one");
  queue.add("two");
  await settle();
  const [one, two] = queue.items();
  assert.equal(queue.beingSent(one), true);
  assert.equal(queue.beingSent(two), false);
  calls[0].fail(new TypeError("Failed to fetch"));
  await settle();
  assert.equal(queue.beingSent(one), false);
  assert.equal(queue.beingSent(two), false);
  mock.timers.tick(3000);
  await settle();
  assert.equal(queue.beingSent(one), true);
  assert.equal(queue.beingSent(two), false);
});

test("when one item finishes or fails, the next is already in flight when the view is redrawn", async (t) => {
  t.after(() => mock.timers.reset());
  mock.timers.enable({ apis: ["setTimeout"] });
  const { calls, send } = fakeSend();
  let seen: string[] = [];
  const queue: ReturnType<typeof createSendQueue<string>> = createSendQueue<string>({
    send,
    onChange: () => { seen = queue.items().filter((i) => queue.beingSent(i)).map((i) => i.job); },
  });
  queue.add("a");
  queue.add("b");
  queue.add("c");
  await settle();
  calls[0].ok();
  await settle();
  assert.deepEqual(seen, ["b"]);
  calls[1].fail(new ApiError("invalid", "bad", 400));
  await settle();
  assert.deepEqual(seen, ["c"]);
});

test("a request that never answers is aborted after 8 seconds, shows Not sent, and the next one is sent", async (t) => {
  t.after(() => mock.timers.reset());
  const { calls, queue } = setup();
  queue.add("stuck");
  queue.add("after");
  await settle();
  mock.timers.tick(7999);
  await settle();
  assert.equal(queue.items()[0].state, "sending");
  assert.equal(calls[0].signal.aborted, false);
  mock.timers.tick(1);
  await settle();
  assert.equal(calls[0].signal.aborted, true);
  assert.equal(queue.items()[0].state, "failed");
  assert.equal(queue.items()[0].reason, "The daemon did not answer");
  assert.deepEqual(calls.map((c) => c.job), ["stuck", "after"]);
});

test("an unreachable daemon is tried again every 3 seconds, in order, and the item goes away once delivered", async (t) => {
  t.after(() => mock.timers.reset());
  const { calls, queue } = setup();
  queue.add("one");
  queue.add("two");
  await settle();
  calls[0].fail(new TypeError("Failed to fetch"));
  await settle();
  assert.equal(queue.items()[0].state, "retry");
  assert.equal(queue.items()[1].state, "sending");
  mock.timers.tick(2999);
  await settle();
  assert.equal(calls.length, 1);
  mock.timers.tick(1);
  await settle();
  assert.deepEqual(calls.map((c) => c.job), ["one", "one"]);
  calls[1].fail(new TypeError("Failed to fetch"));
  await settle();
  mock.timers.tick(3000);
  await settle();
  assert.equal(calls.length, 3);
  calls[2].ok();
  await settle();
  assert.deepEqual(calls.map((c) => c.job), ["one", "one", "one", "two"]);
  calls[3].ok();
  await settle();
  assert.deepEqual(queue.items(), []);
});

test("a timeout, a 4xx and a 5xx are not tried again by themselves", async (t) => {
  t.after(() => mock.timers.reset());
  const { calls, queue } = setup();
  queue.add("slow");
  queue.add("bad");
  queue.add("broken");
  await settle();
  mock.timers.tick(8000);
  await settle();
  calls[1].fail(new ApiError("invalid", "text is empty", 400));
  await settle();
  calls[2].fail(new ApiError("internal", "boom", 500));
  await settle();
  mock.timers.tick(60000);
  await settle();
  assert.equal(calls.length, 3);
  assert.deepEqual(queue.items().map((i) => [i.state, i.reason]), [
    ["failed", "The daemon did not answer"],
    ["failed", "text is empty"],
    ["failed", "boom"],
  ]);
});

test("Retry sends a Not sent item again and Remove drops it", async (t) => {
  t.after(() => mock.timers.reset());
  const { calls, queue } = setup();
  queue.add("bad");
  queue.add("other");
  await settle();
  calls[0].fail(new ApiError("invalid", "no", 400));
  await settle();
  calls[1].fail(new ApiError("invalid", "no", 400));
  await settle();
  const [bad, other] = queue.items();
  queue.retry(bad);
  await settle();
  assert.equal(calls.length, 3);
  assert.equal(calls[2].job, "bad");
  assert.equal(bad.state, "sending");
  calls[2].ok();
  await settle();
  assert.deepEqual(queue.items(), [other]);
  queue.remove(other);
  assert.deepEqual(queue.items(), []);
});
