import assert from "node:assert/strict";
import test from "node:test";

import type { DurableEventEnvelope } from "@snezhok/contracts";

import { SyncEngine } from "./syncEngine";

const removed = (cursor: number): DurableEventEnvelope => ({
  cursor,
  name: "conversation:removed",
  payload: { id: crypto.randomUUID() },
});

test("sync engine applies envelopes serially and commits only after projection", async () => {
  let cursor = 0;
  const order: string[] = [];
  let releaseFirst: (() => void) | undefined;
  const first = new Promise<void>((resolve) => { releaseFirst = resolve; });
  const engine = new SyncEngine({
    getCursor: () => cursor,
    apply: async (event) => {
      order.push(`apply:${event.cursor}`);
      if (event.cursor === 10) await first;
    },
    commitCursor: (next) => { cursor = next; order.push(`commit:${next}`); },
    recover: () => assert.fail("recovery was not expected"),
  });

  const ten = engine.accept(removed(10));
  const eleven = engine.accept(removed(11));
  await Promise.resolve();
  assert.deepEqual(order, ["apply:10"]);
  releaseFirst?.();
  await Promise.all([ten, eleven]);
  assert.deepEqual(order, ["apply:10", "commit:10", "apply:11", "commit:11"]);
  assert.equal(cursor, 11);
});

test("sync engine ignores duplicate and reordered envelopes", async () => {
  let cursor = 8;
  let applied = 0;
  const engine = new SyncEngine({
    getCursor: () => cursor,
    apply: () => { applied += 1; },
    commitCursor: (next) => { cursor = next; },
    recover: () => assert.fail("recovery was not expected"),
  });
  await engine.accept(removed(8));
  await engine.accept(removed(7));
  await engine.accept(removed(9));
  assert.equal(applied, 1);
  assert.equal(cursor, 9);
});

test("failed projection never acknowledges the envelope and recovers by snapshot", async () => {
  let cursor = 4;
  let recoveries = 0;
  const engine = new SyncEngine({
    getCursor: () => cursor,
    apply: () => { throw new Error("projection failed"); },
    commitCursor: (next) => { cursor = next; },
    recover: () => { recoveries += 1; cursor = 20; },
  });
  await engine.accept(removed(5));
  assert.equal(recoveries, 1);
  assert.equal(cursor, 20, "the snapshot cursor must not be replaced by the failed envelope");
});

test("failed recovery halts the stream until a new socket resumes it", async () => {
  let cursor = 0;
  let shouldFail = true;
  let applied = 0;
  const engine = new SyncEngine({
    getCursor: () => cursor,
    apply: () => {
      applied += 1;
      if (shouldFail) throw new Error("projection failed");
    },
    commitCursor: (next) => { cursor = next; },
    recover: () => { throw new Error("offline"); },
  });
  await assert.rejects(engine.accept(removed(1)), /offline/);
  await assert.rejects(engine.accept(removed(2)), /offline/);
  assert.equal(applied, 1, "a broken stream must not skip past an unacknowledged event");

  shouldFail = false;
  engine.resume();
  await engine.accept(removed(2));
  assert.equal(cursor, 2);
});
