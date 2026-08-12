import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("activity collage migration creates a bounded nine-source media operation", async () => {
  const sql = await readFile(new URL("../../migrations/0019_activity_collages.sql", import.meta.url), "utf8");
  assert.match(sql, /operation IN \('standard','color-collage'\)/);
  assert.match(sql, /cardinality\(source_attachment_ids\)=9/);
  assert.match(sql, /ALTER COLUMN blob_id DROP NOT NULL/);
});
