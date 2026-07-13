import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

test("public registration migration preserves users and retires invite storage", async () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const migrations = path.resolve(here, "../../migrations");
  const db = new PGlite();
  try {
    await db.exec(await readFile(path.join(migrations, "0001_initial.sql"), "utf8"));
    await db.query(
      "INSERT INTO users(id, username, display_name) VALUES ($1, $2, $3)",
      ["00000000-0000-4000-8000-000000000001", "existing", "Existing user"],
    );
    await db.exec(await readFile(path.join(migrations, "0003_public_registration.sql"), "utf8"));

    const existing = await db.query<{ email: string | null }>("SELECT email FROM users WHERE username='existing'");
    assert.equal(existing.rows[0]?.email, null);
    const invites = await db.query("SELECT 1 FROM information_schema.tables WHERE table_name='invite_codes'");
    assert.equal(invites.rows.length, 0);

    await db.query(
      "INSERT INTO users(id, email, username, display_name) VALUES ($1, $2, $3, $4)",
      ["00000000-0000-4000-8000-000000000002", "new@example.com", "new-user", "New user"],
    );
    await assert.rejects(
      db.query(
        "INSERT INTO users(id, email, username, display_name) VALUES ($1, $2, $3, $4)",
        ["00000000-0000-4000-8000-000000000003", "new@example.com", "other-user", "Other user"],
      ),
    );
  } finally {
    await db.close();
  }
});
