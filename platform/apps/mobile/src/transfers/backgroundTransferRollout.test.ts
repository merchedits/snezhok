import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("release uploads prefer durable WorkManager and retain a safe compatibility fallback", async () => {
  const store = await readFile(new URL("../store/useAppStore.ts", import.meta.url), "utf8");
  const domain = await readFile(new URL("../application/messaging/attachmentTransferDomain.ts", import.meta.url), "utf8");
  assert.match(store, /available: backgroundTransferAvailable/);
  assert.match(domain, /if \(!background\.available\)/);
  assert.match(domain, /sendForegroundAttachmentBatch/);
  assert.match(domain, /background\.enqueueBatch/);
});
