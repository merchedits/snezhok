import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("deployments verify every database media reference before and after release", async () => {
  const [integrity, deploy, verify] = await Promise.all([
    readFile(new URL("./verify-media-storage.sh", import.meta.url), "utf8"),
    readFile(new URL("./deploy-production.sh", import.meta.url), "utf8"),
    readFile(new URL("./verify-production-release.sh", import.meta.url), "utf8"),
  ]);
  assert.match(integrity, /SELECT storage_key,bytes FROM blobs/);
  assert.match(integrity, /realpath -e/);
  assert.match(integrity, /actual_bytes/);
  assert.match(integrity, /runuser -u www-data -- test -r/);
  assert.match(deploy, /verify-media-storage\.sh/);
  assert.match(verify, /verify-media-storage\.sh/);
});
