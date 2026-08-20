import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

import type { DbClient } from "./pool.js";
import { effectiveMemberPolicy, requireRuntimeCapability } from "../modules/admin/policy.js";

test("runtime capabilities are authenticated, fail closed, and gate permissions", async () => {
  const db = new PGlite();
  try {
    const migrations = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../migrations");
    for (const filename of (await readdir(migrations)).filter((name) => name.endsWith(".sql")).sort()) {
      await db.exec(await readFile(path.join(migrations, filename), "utf8"));
    }
    const userId = crypto.randomUUID();
    await db.query("INSERT INTO users(id,username,display_name) VALUES ($1,'capability_user','Capability User')", [userId]);

    const initial = await effectiveMemberPolicy(userId, db as unknown as DbClient);
    assert.equal(initial.capabilities.uploads, true);
    assert.equal(initial.capabilities.calls, true);
    assert.equal(initial.capabilities.activities, true);
    assert.equal(initial.capabilities.servers, false);
    assert.equal(initial.permissions.createServers, false, "a permission cannot bypass the server kill switch");

    await db.query(
      `UPDATE global_admin_settings
          SET revision=revision+1,
              feature_capabilities='{"uploads":false,"calls":false,"activities":false,"servers":false}'::jsonb
        WHERE singleton=true`,
    );
    const disabled = await effectiveMemberPolicy(userId, db as unknown as DbClient);
    assert.equal(disabled.permissions.uploadFiles, false);
    assert.equal(disabled.permissions.startCalls, false);
    assert.equal(disabled.capabilities.activities, false);
    await assert.rejects(
      () => requireRuntimeCapability(userId, "activities", db as unknown as DbClient),
      (error: unknown) => error instanceof Error && error.message === "This feature is temporarily unavailable",
    );

    await assert.rejects(
      db.query("UPDATE global_admin_settings SET feature_capabilities='{}'::jsonb WHERE singleton=true"),
      /check constraint/i,
    );
  } finally {
    await db.close();
  }
});
