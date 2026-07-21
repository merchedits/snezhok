import { readdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "./pool.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDirectory = path.resolve(here, "../../migrations");

export async function migrate() {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [734_927_301]);
    await client.query("CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now(), checksum_sha256 text)");
    await client.query("ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS checksum_sha256 text");
    const files = (await readdir(migrationsDirectory)).filter((file) => file.endsWith(".sql")).sort();
    const migrations = await Promise.all(files.map(async (file) => {
      const sql = await readFile(path.join(migrationsDirectory, file), "utf8");
      return { file, sql, checksum: migrationChecksum(sql) };
    }));
    const appliedRows = (await client.query<{ version: string; checksum_sha256: string | null }>("SELECT version,checksum_sha256 FROM schema_migrations")).rows;
    const available = new Set(files);
    const removed = appliedRows.find((row) => !available.has(row.version));
    if (removed) throw new Error(`Applied migration is missing from this release: ${removed.version}`);
    const applied = new Map(appliedRows.map((row) => [row.version, row.checksum_sha256]));
    for (const migration of migrations) {
      const previousChecksum = applied.get(migration.file);
      if (previousChecksum !== undefined) {
        if (previousChecksum === null) {
          await client.query("UPDATE schema_migrations SET checksum_sha256=$2 WHERE version=$1 AND checksum_sha256 IS NULL", [migration.file, migration.checksum]);
        } else if (previousChecksum !== migration.checksum) {
          throw new Error(`Applied migration checksum mismatch: ${migration.file}`);
        }
        continue;
      }
      await client.query("BEGIN");
      try {
        await client.query("SET LOCAL statement_timeout='5min'");
        await client.query(migration.sql);
        await client.query("INSERT INTO schema_migrations(version,checksum_sha256) VALUES ($1,$2)", [migration.file, migration.checksum]);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [734_927_301]).catch(() => undefined);
    client.release();
  }
}

export function migrationChecksum(sql: string) {
  return createHash("sha256").update(sql, "utf8").digest("hex");
}
