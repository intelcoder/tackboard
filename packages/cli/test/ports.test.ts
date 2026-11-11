import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:net";
import type { Server } from "node:net";
import { choosePort } from "../src/commands.ts";

const hold = (port: number) =>
  new Promise<Server>((res, rej) => {
    const s = createServer();
    s.once("error", rej);
    s.listen(port, "127.0.0.1", () => res(s));
  });

/** A free run of three ports to stand in for the extension's range, so a daemon of the developer's own on 47800 cannot disturb the test. */
async function freeRun(): Promise<number> {
  for (let tries = 0; tries < 20; tries++) {
    const first = 20000 + Math.floor(Math.random() * 30000);
    try {
      const held = await Promise.all([hold(first), hold(first + 1), hold(first + 2)]);
      await Promise.all(held.map((s) => new Promise((done) => s.close(done))));
      return first;
    } catch {
      // one of them is taken: draw again
    }
  }
  throw new Error("no free run of ports");
}

test("choosePort: each project takes the next free port of the range, and a full range falls back", async () => {
  const first = await freeRun();
  const taken: Server[] = [];
  try {
    assert.equal(await choosePort(undefined, first, 3), first);
    taken.push(await hold(first));
    assert.equal(await choosePort(undefined, first, 3), first + 1, "a second project");
    taken.push(await hold(first + 1));
    assert.equal(await choosePort(undefined, first, 3), first + 2);
    taken.push(await hold(first + 2));
    assert.equal(await choosePort({ port: 4321 }, first, 3), 4321, "range full: keep the project's old port");
    assert.equal(await choosePort({ port: first + 1 }, first, 3), first + 1, "a project already in the range keeps its port, even while its own daemon holds it");
    const other = await choosePort(undefined, first, 3);
    assert.ok(other > 0 && other < first || other > first + 2, "range full and no old port: any free port, outside the range");
  } finally {
    await Promise.all(taken.map((s) => new Promise((done) => s.close(done))));
  }
});
