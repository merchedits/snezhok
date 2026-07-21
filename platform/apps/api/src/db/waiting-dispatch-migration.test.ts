import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("waiting attachment dispatch migration is durable and indexed", async () => {
  const sql = await readFile(new URL("../../migrations/0017_waiting_attachment_dispatch.sql", import.meta.url), "utf8");
  for (const invariant of ["'waiting'", "ADD COLUMN expires_at", "scheduled_messages_waiting_expiry_idx", "status='waiting'"]) {
    assert.match(sql, new RegExp(invariant.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});
