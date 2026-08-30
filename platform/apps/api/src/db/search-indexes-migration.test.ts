import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("global search has substring indexes for messages, files, and people", async () => {
  const sql = await readFile(new URL("../../migrations/0028_search_indexes.sql", import.meta.url), "utf8");
  assert.match(sql, /CREATE EXTENSION IF NOT EXISTS pg_trgm/);
  assert.match(sql, /messages USING gin \(text gin_trgm_ops\)/);
  assert.match(sql, /attachments USING gin \(filename gin_trgm_ops\)/);
  assert.match(sql, /users USING gin \(username gin_trgm_ops\)/);
  assert.match(sql, /users USING gin \(display_name gin_trgm_ops\)/);
});
