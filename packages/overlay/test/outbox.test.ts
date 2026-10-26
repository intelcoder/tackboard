import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { ApiError } from "../src/api.ts";
import { createOutbox } from "../src/outbox.ts";

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
  const box = createOutbox<string>({ send: fake.send, onChange: () => {} });
  return { ...fake, box };
}

test("messages are sent one at a time, oldest first", async (t) => {
  t.after(() => mock.timers.reset());
  const { calls, box } = setup();
  box.add("one");
  box.add("two");
  await settle();
  assert.deepEqual(calls.map((c) => c.job), ["one"]);
  calls[0].ok();
  await settle();
  assert.deepEqual(calls.map((c) => c.job), ["one", "two"]);
  calls[1].ok();
  await settle();
  assert.deepEqual(box.items(), []);
});

test("only the item whose request is in flight is sending; one behind a waiting item is not", async (t) => {
  t.after(() => mock.timers.reset());
  const { calls, box } = setup();
  box.add("one");
  box.add("two");
  await settle();
  const [one, two] = box.items();
  assert.equal(box.inflight(one), true);
  assert.equal(box.inflight(two), false);
  calls[0].fail(new TypeError("Failed to fetch"));
  await settle();
  assert.equal(box.inflight(one), false);
  assert.equal(box.inflight(two), false);
  mock.timers.tick(3000);
  await settle();
  assert.equal(box.inflight(one), true);
  assert.equal(box.inflight(two), false);
});

test("when one item finishes or fails, the next is already in flight when the view is redrawn", async (t) => {
  t.after(() => mock.timers.reset());
  mock.timers.enable({ apis: ["setTimeout"] });
  const { calls, send } = fakeSend();
  let seen: string[] = [];
  const box: ReturnType<typeof createOutbox<string>> = createOutbox<string>({
    send,
    onChange: () => { seen = box.items().filter((i) => box.inflight(i)).map((i) => i.job); },
  });
  box.add("a");
  box.add("b");
  box.add("c");
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
  const { calls, box } = setup();
  box.add("stuck");
  box.add("after");
  await settle();
  mock.timers.tick(7999);
  await settle();
  assert.equal(box.items()[0].state, "sending");
  assert.equal(calls[0].signal.aborted, false);
  mock.timers.tick(1);
  await settle();
  assert.equal(calls[0].signal.aborted, true);
  assert.equal(box.items()[0].state, "failed");
  assert.equal(box.items()[0].reason, "The daemon did not answer");
  assert.deepEqual(calls.map((c) => c.job), ["stuck", "after"]);
});

test("an unreachable daemon is tried again every 3 seconds, in order, and the item goes away once delivered", async (t) => {
  t.after(() => mock.timers.reset());
  const { calls, box } = setup();
  box.add("one");
  box.add("two");
  await settle();
  calls[0].fail(new TypeError("Failed to fetch"));
  await settle();
  assert.equal(box.items()[0].state, "retry");
  assert.equal(box.items()[1].state, "sending");
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
  assert.deepEqual(box.items(), []);
});

test("a timeout, a 4xx and a 5xx are not tried again by themselves", async (t) => {
  t.after(() => mock.timers.reset());
  const { calls, box } = setup();
  box.add("slow");
  box.add("bad");
  box.add("broken");
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
  assert.deepEqual(box.items().map((i) => [i.state, i.reason]), [
    ["failed", "The daemon did not answer"],
    ["failed", "text is empty"],
    ["failed", "boom"],
  ]);
});

test("Retry sends a Not sent item again and Remove drops it", async (t) => {
  t.after(() => mock.timers.reset());
  const { calls, box } = setup();
  box.add("bad");
  box.add("other");
  await settle();
  calls[0].fail(new ApiError("invalid", "no", 400));
  await settle();
  calls[1].fail(new ApiError("invalid", "no", 400));
  await settle();
  const [bad, other] = box.items();
  box.retry(bad);
  await settle();
  assert.equal(calls.length, 3);
  assert.equal(calls[2].job, "bad");
  assert.equal(bad.state, "sending");
  calls[2].ok();
  await settle();
  assert.deepEqual(box.items(), [other]);
  box.remove(other);
  assert.deepEqual(box.items(), []);
});
