import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

test("client diagnostic aggregation is deduplicated and stores no report payload", async () => {
  const db = new PGlite();
  try {
    const migrations = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../migrations");
    for (const filename of (await readdir(migrations)).filter((name) => name.endsWith(".sql")).sort()) {
      await db.exec(await readFile(path.join(migrations, filename), "utf8"));
    }
    const columns = (await db.query<{ column_name: string }>(
      "SELECT column_name FROM information_schema.columns WHERE table_name IN ('client_diagnostic_events','client_diagnostic_aggregates')",
    )).rows.map((row) => row.column_name);
    assert(!columns.includes("payload"));
    assert(!columns.includes("user_id"));
    await db.query("INSERT INTO client_diagnostic_events(event_hash) VALUES ($1) ON CONFLICT DO NOTHING", ["a".repeat(64)]);
    await db.query("INSERT INTO client_diagnostic_events(event_hash) VALUES ($1) ON CONFLICT DO NOTHING", ["a".repeat(64)]);
    assert.equal((await db.query<{ count: string }>("SELECT count(*)::text count FROM client_diagnostic_events")).rows[0]?.count, "1");
  } finally {
    await db.close();
  }
});
