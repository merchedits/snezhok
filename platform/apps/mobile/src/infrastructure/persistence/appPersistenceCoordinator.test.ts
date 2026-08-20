import assert from "node:assert/strict";
import test from "node:test";

import { AppPersistenceCoordinator } from "./appPersistenceCoordinator";

const snapshot = () => ({ bootstrap: null, messages: {}, outbox: [] });

test("persistence coordinator coalesces removals and snapshots independent stores once", async () => {
  const deltas: unknown[] = [];
  let outboxWrites = 0;
  const coordinator = new AppPersistenceCoordinator({
    snapshot,
    writeCacheDelta: async (delta) => { deltas.push(delta); },
    writeOutbox: async () => { outboxWrites += 1; },
    reportFailure: () => assert.fail("unexpected persistence failure"),
  });
  await coordinator.persist({
    bootstrap: true,
    outbox: true,
    streamIds: ["keep", "remove"],
    removedStreamIds: ["remove"],
    removedMessages: [{ streamId: "keep", messageId: "message" }],
  });
  assert.equal(deltas.length, 1);
  assert.equal(outboxWrites, 1);
  assert.deepEqual(deltas[0], {
    cachedAt: (deltas[0] as { cachedAt: number }).cachedAt,
    bootstrap: null,
    streams: { keep: [] },
    removedStreamIds: ["remove"],
    removedMessageIds: { keep: ["message"] },
  });
});

test("cancelling an account generation drops delayed writes", async () => {
  let writes = 0;
  const coordinator = new AppPersistenceCoordinator({
    snapshot,
    writeCacheDelta: async () => { writes += 1; },
    writeOutbox: async () => undefined,
    reportFailure: () => assert.fail("unexpected persistence failure"),
    debounceMs: 5,
  });
  coordinator.schedule({ bootstrap: true });
  coordinator.cancel();
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal(writes, 0);
});

test("a transient disk error retains dirty projection for bounded retry", async () => {
  let attempts = 0;
  const coordinator = new AppPersistenceCoordinator({
    snapshot,
    writeCacheDelta: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("disk busy");
    },
    writeOutbox: async () => undefined,
    reportFailure: () => undefined,
    retryMs: 5,
  });
  await assert.rejects(coordinator.persist({ bootstrap: true }), /disk busy/);
  await new Promise((resolve) => setTimeout(resolve, 15));
  await coordinator.settled();
  assert.equal(attempts, 2);
});
