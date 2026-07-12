import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

test("media migration adds durable leases, retries and explicit derivatives", async () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const migrations = path.resolve(here, "../../migrations");
  const db = new PGlite();
  try {
    await db.exec(await readFile(path.join(migrations, "0001_initial.sql"), "utf8"));
    await db.exec(await readFile(path.join(migrations, "0002_media_pipeline.sql"), "utf8"));
    const columns = await db.query<{ column_name: string }>("SELECT column_name FROM information_schema.columns WHERE table_name='media_jobs'");
    for (const expected of ["max_attempts", "locked_by", "heartbeat_at", "cancel_requested_at"]) assert.ok(columns.rows.some((row) => row.column_name === expected));
    const variants = await db.query("SELECT 1 FROM information_schema.tables WHERE table_name='media_variants'");
    assert.equal(variants.rows.length, 1);
  } finally { await db.close(); }
});
