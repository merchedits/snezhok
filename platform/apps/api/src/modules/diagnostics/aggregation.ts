import { createHash } from "node:crypto";
import type { DiagnosticAggregate, DiagnosticReport } from "@snezhok/contracts";

import { pool, type DbClient } from "../../db/pool.js";

type DiagnosticClient = Pick<DbClient, "query">;

export async function persistDiagnosticReport(report: DiagnosticReport, client: DiagnosticClient = pool): Promise<void> {
  if (!report.events.length) return;
  const installation = digest(`snezhok-diagnostics:${report.installationId}`).slice(0, 16);
  const now = Date.now();
  const earliest = now - 30 * 24 * 60 * 60_000;
  const latest = now + 5 * 60_000;
  const events = report.events.map((event) => {
    const eventAt = new Date(Math.min(latest, Math.max(earliest, event.at))).toISOString();
    const signatureMaterial = [event.category, event.level, event.message, event.context?.errorName, event.context?.type, event.context?.frame, event.context?.name, event.context?.description, event.context?.reason].join("\u0000");
    return {
      event_hash: digest(`${installation}:${event.id}`),
      event_at: eventAt,
      category: event.category,
      level: event.level,
      event_name: event.message,
      signature: digest(signatureMaterial),
      duration_ms: event.durationMs ?? null,
    };
  });
  await client.query(
    `WITH incoming AS (
       SELECT * FROM jsonb_to_recordset($1::jsonb) AS item(
         event_hash text,event_at timestamptz,category text,level text,event_name text,signature text,duration_ms double precision
       )
     ), accepted AS (
       INSERT INTO client_diagnostic_events(event_hash)
       SELECT event_hash FROM incoming
       ON CONFLICT DO NOTHING
       RETURNING event_hash
     ), accepted_rows AS (
       SELECT incoming.* FROM incoming JOIN accepted USING(event_hash)
     )
     INSERT INTO client_diagnostic_aggregates(
       bucket_date,app_version,version_code,os_version,device,category,level,event_name,signature,
       occurrences,first_seen_at,last_seen_at,max_duration_ms
     )
     SELECT event_at::date,$2,$3,$4,$5,category,level,event_name,signature,
            count(*),min(event_at),max(event_at),max(duration_ms)
       FROM accepted_rows
      GROUP BY event_at::date,category,level,event_name,signature
     ON CONFLICT (bucket_date,app_version,version_code,os_version,device,signature)
     DO UPDATE SET occurrences=client_diagnostic_aggregates.occurrences+excluded.occurrences,
                   first_seen_at=least(client_diagnostic_aggregates.first_seen_at,excluded.first_seen_at),
                   last_seen_at=greatest(client_diagnostic_aggregates.last_seen_at,excluded.last_seen_at),
                   max_duration_ms=greatest(client_diagnostic_aggregates.max_duration_ms,excluded.max_duration_ms)`,
    [JSON.stringify(events), report.appVersion, report.versionCode, report.osVersion, report.device],
  );
}

export async function recentDiagnosticAggregates(days = 7, client: DiagnosticClient = pool): Promise<DiagnosticAggregate[]> {
  const boundedDays = Math.min(30, Math.max(1, Math.trunc(days)));
  const result = await client.query<{
    bucket_date: string; app_version: string; version_code: number; os_version: string; device: string;
    category: DiagnosticAggregate["category"]; level: DiagnosticAggregate["level"]; event_name: string;
    occurrences: string; first_seen_ms: number; last_seen_ms: number; max_duration_ms: number | null;
  }>(
    `SELECT bucket_date::text,app_version,version_code,os_version,device,category,level,event_name,
            occurrences::text,(extract(epoch from first_seen_at)*1000)::bigint::float8 first_seen_ms,
            (extract(epoch from last_seen_at)*1000)::bigint::float8 last_seen_ms,max_duration_ms
       FROM client_diagnostic_aggregates
      WHERE bucket_date >= current_date-$1::integer
      ORDER BY last_seen_at DESC
      LIMIT 500`,
    [boundedDays - 1],
  );
  return result.rows.map((row) => ({
    bucketDate: row.bucket_date,
    appVersion: row.app_version,
    versionCode: row.version_code,
    osVersion: row.os_version,
    device: row.device,
    category: row.category,
    level: row.level,
    eventName: row.event_name,
    occurrences: Number(row.occurrences),
    firstSeenAt: row.first_seen_ms,
    lastSeenAt: row.last_seen_ms,
    maxDurationMs: row.max_duration_ms,
  }));
}

export async function diagnosticProblemCount(hours = 24, client: DiagnosticClient = pool): Promise<number> {
  const boundedHours = Math.min(168, Math.max(1, Math.trunc(hours)));
  const result = await client.query<{ count: string }>(
    `SELECT coalesce(sum(occurrences),0)::text count
       FROM client_diagnostic_aggregates
      WHERE level IN ('warn','error') AND last_seen_at >= now()-($1::text||' hours')::interval`,
    [boundedHours],
  );
  return Number(result.rows[0]?.count ?? 0);
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
