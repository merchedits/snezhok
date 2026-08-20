import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { AppError } from "../../lib/errors.js";
import { assertGlobalAdmin } from "./middleware.js";
import { defaultGlobalPermissions, mergePermissions } from "./policy.js";
import { adminMemberPatchSchema, adminSettingsPatchSchema } from "./schemas.js";
import { assertMayDeleteAccount } from "../users/account.js";

test("global administration authorization fails closed", () => {
  assert.doesNotThrow(() => assertGlobalAdmin({ isAdmin: true }));
  assert.throws(() => assertGlobalAdmin({ isAdmin: false }), (error: unknown) => error instanceof AppError && error.status === 403);
});

test("administration validation is strict and bounded", () => {
  assert.equal(adminMemberPatchSchema.safeParse({}).success, false);
  assert.equal(adminMemberPatchSchema.safeParse({ suspended: true, unknown: true }).success, false);
  assert.equal(adminMemberPatchSchema.safeParse({ storageQuotaBytes: 1024 }).success, false);
  assert.equal(adminSettingsPatchSchema.safeParse({ revision: 1 }).success, false);
  assert.equal(adminSettingsPatchSchema.safeParse({ revision: 1, messageRetentionDays: null }).success, true);
  assert.equal(adminSettingsPatchSchema.safeParse({ revision: 1, eventRetentionDays: 0 }).success, false);
  assert.equal(adminSettingsPatchSchema.safeParse({ revision: 1, featureCapabilities: { uploads: true } }).success, false);
  assert.equal(adminSettingsPatchSchema.safeParse({
    revision: 1,
    featureCapabilities: { uploads: true, calls: true, activities: false, servers: false },
  }).success, true);
});

test("permission overrides remain sparse and defaults continue to flow through", () => {
  assert.deepEqual(mergePermissions({ ...defaultGlobalPermissions, createServers: false }, { uploadFiles: false }), {
    createServers: false, createGroups: true, uploadFiles: false, startCalls: true,
  });
  assert.deepEqual(mergePermissions(null, { startCalls: false, unexpected: true }), {
    createServers: true, createGroups: true, uploadFiles: true, startCalls: false,
  });
});

test("migration installs revisioned settings and stale writes cannot win", async () => {
  const db = new PGlite();
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const migrations = path.resolve(here, "../../../migrations");
    for (const filename of (await readdir(migrations)).filter((name) => name.endsWith(".sql")).sort()) {
      await db.exec(await readFile(path.join(migrations, filename), "utf8"));
    }
    const tables = await db.query<{ table_name: string }>("SELECT table_name FROM information_schema.tables WHERE table_schema='public'");
    assert.equal(tables.rows.some((row) => row.table_name === "global_admin_settings"), true);
    assert.equal(tables.rows.some((row) => row.table_name === "user_admin_policies"), true);

    const first = await db.query("UPDATE global_admin_settings SET revision=revision+1 WHERE singleton=true AND revision=1 RETURNING revision");
    const stale = await db.query("UPDATE global_admin_settings SET revision=revision+1 WHERE singleton=true AND revision=1 RETURNING revision");
    assert.equal(first.rows.length, 1);
    assert.equal(stale.rows.length, 0);
  } finally {
    await db.close();
  }
});

test("suspension revokes durable sessions and ejects already-connected realtime clients", async () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const [routes, realtime] = await Promise.all([
    readFile(path.join(here, "routes.ts"), "utf8"),
    readFile(path.resolve(here, "../realtime/socket.ts"), "utf8"),
  ]);
  assert.match(routes, /revoked_reason='account_suspended'/);
  assert.match(routes, /pg_notify\('snezhok_admin'/);
  assert.match(realtime, /LISTEN snezhok_admin/);
  assert.match(realtime, /disconnectSockets\(true\)/);
});

test("the final active administrator cannot delete their account", async () => {
  const calls: Array<{ sql: string; values?: unknown[] }> = [];
  const client = {
    query: async (sql: string, values?: unknown[]) => {
      calls.push(values ? { sql, values } : { sql });
      if (sql.startsWith("SELECT is_admin")) return { rows: [{ is_admin: true }], rowCount: 1 };
      if (sql.startsWith("SELECT 1 FROM users")) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 0 };
    },
  };
  await assert.rejects(() => assertMayDeleteAccount(client as never, "00000000-0000-4000-8000-000000000001"),
    (error: unknown) => error instanceof AppError && error.status === 409);
  assert.match(calls[0]!.sql, /pg_advisory_xact_lock/);
});
