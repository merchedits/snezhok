import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("release uploads prefer durable WorkManager and retain a safe compatibility fallback", async () => {
  const store = await readFile(new URL("../store/useAppStore.ts", import.meta.url), "utf8");
  assert.match(store, /const DURABLE_BACKGROUND_TRANSFERS_ENABLED = true/);
  assert.match(store, /!DURABLE_BACKGROUND_TRANSFERS_ENABLED \|\| !backgroundTransferAvailable/);
  assert.match(store, /sendForegroundAttachmentBatch/);
  assert.match(store, /enqueueBackgroundAttachmentBatch/);
});
