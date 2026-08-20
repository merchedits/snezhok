import assert from "node:assert/strict";
import test from "node:test";

import { TransferManager } from "./transferManager";

test("independent transfers progress and cancel without a global upload lock", async () => {
  const manager = new TransferManager();
  const first = manager.begin({ id: "first", ownerId: "owner", kind: "foreground-upload" });
  const second = manager.begin({ id: "second", ownerId: "owner", kind: "foreground-upload" });
  let firstCancelled = 0;
  first.onCancel(() => { firstCancelled += 1; });
  first.updateProgress(40);
  second.updateProgress(70);

  assert.equal(await manager.cancel(first.id), true);
  assert.equal(first.cancelled, true);
  assert.equal(second.cancelled, false);
  assert.equal(firstCancelled, 1);
  second.complete();
  assert.deepEqual(manager.snapshots().map(({ id, status, progress }) => ({ id, status, progress })), [
    { id: "first", status: "cancelled", progress: 40 },
    { id: "second", status: "completed", progress: 100 },
  ]);
});

test("owner-scoped cancellation cannot affect another signed-in account", async () => {
  const manager = new TransferManager();
  const oldAccount = manager.begin({ id: "old", ownerId: "old-owner", kind: "background-batch" });
  const currentAccount = manager.begin({ id: "current", ownerId: "current-owner", kind: "background-batch" });
  await manager.cancelWhere((snapshot) => snapshot.ownerId === "old-owner");
  assert.equal(oldAccount.cancelled, true);
  assert.equal(currentAccount.cancelled, false);
});
