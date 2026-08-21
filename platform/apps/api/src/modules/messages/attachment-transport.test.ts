import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const optionalPrimaryChecksum = /\|\| CASE WHEN p\.checksum_sha256 IS NULL THEN '\{\}'::jsonb ELSE jsonb_build_object\('primaryChecksum',p\.checksum_sha256\) END/;

test("message and activity projections omit an unavailable primary checksum", async () => {
  const [messages, activities] = await Promise.all([
    readFile(new URL("./service.ts", import.meta.url), "utf8"),
    readFile(new URL("../activities/view.ts", import.meta.url), "utf8"),
  ]);
  assert.match(messages, optionalPrimaryChecksum);
  assert.match(activities, optionalPrimaryChecksum);
  assert.doesNotMatch(messages, /'primaryChecksum',p\.checksum_sha256,'waveform'/);
  assert.doesNotMatch(activities, /'primaryChecksum',p\.checksum_sha256,'waveform'/);
});
