import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

import type { DiagnosticReport } from "@snezhok/contracts";
import type { DbClient } from "../../db/pool.js";
import { persistDiagnosticReport, recentDiagnosticAggregates } from "./aggregation.js";

test("diagnostic events aggregate once across an ambiguous report retry", async () => {
  const db = new PGlite();
  try {
    const migrations = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../migrations");
    for (const filename of (await readdir(migrations)).filter((name) => name.endsWith(".sql")).sort()) {
      await db.exec(await readFile(path.join(migrations, filename), "utf8"));
    }
    const report: DiagnosticReport = {
      installationId: "installation-a",
      appVersion: "4.4.0",
      versionCode: 41,
      platform: "android",
      osVersion: "12",
      device: "SM-A125F",
      locale: "ru",
      recordedAt: Date.now(),
      events: [{ id: crypto.randomUUID(), at: Date.now(), level: "error", category: "native-crash", message: "Previous process ended with an uncaught native exception", context: { type: "IllegalStateException" } }],
    };
    const client = db as unknown as DbClient;
    await persistDiagnosticReport(report, client);
    await persistDiagnosticReport(report, client);
    const aggregates = await recentDiagnosticAggregates(1, client);
    assert.equal(aggregates.length, 1);
    assert.equal(aggregates[0]?.occurrences, 1);
    assert.equal(aggregates[0]?.device, "SM-A125F");
  } finally {
    await db.close();
  }
});
