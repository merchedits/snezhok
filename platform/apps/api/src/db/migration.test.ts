import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

test("initial PostgreSQL migration creates the durable domain schema", async () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const sql = await readFile(path.resolve(here, "../../migrations/0001_initial.sql"), "utf8");
  const db = new PGlite();
  try {
    await db.exec(sql);
    const result = await db.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name",
    );
    const tables = result.rows.map((row) => row.table_name);
    for (const required of ["users", "device_sessions", "servers", "channels", "conversations", "messages", "upload_sessions", "attachments", "user_events", "legacy_import_map"]) {
      assert.ok(tables.includes(required), `missing ${required}`);
    }
    const activeCallIndex = await db.query<{ indexname: string }>("SELECT indexname FROM pg_indexes WHERE indexname='call_sessions_one_active_stream_idx'");
    assert.equal(activeCallIndex.rows.length, 1);
  } finally {
    await db.close();
  }
});
