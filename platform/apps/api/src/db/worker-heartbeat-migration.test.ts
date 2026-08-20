import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

test("domain worker heartbeat is revision-bound and restart-aware", async () => {
  const db = new PGlite();
  try {
    const migrations = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../migrations");
    for (const filename of (await readdir(migrations)).filter((name) => name.endsWith(".sql")).sort()) {
      await db.exec(await readFile(path.join(migrations, filename), "utf8"));
    }
    await db.query("INSERT INTO worker_heartbeats(worker_name,instance_id,source_revision) VALUES ('domain-jobs','one',$1)", ["a".repeat(40)]);
    await db.query(
      `INSERT INTO worker_heartbeats(worker_name,instance_id,source_revision) VALUES ('domain-jobs','two',$1)
       ON CONFLICT(worker_name) DO UPDATE SET instance_id=EXCLUDED.instance_id,source_revision=EXCLUDED.source_revision,started_at=now(),last_seen_at=now()`,
      ["b".repeat(40)],
    );
    const row = (await db.query<{ instance_id: string; source_revision: string }>("SELECT instance_id,source_revision FROM worker_heartbeats WHERE worker_name='domain-jobs'")).rows[0];
    assert.deepEqual(row, { instance_id: "two", source_revision: "b".repeat(40) });
  } finally {
    await db.close();
  }
});
