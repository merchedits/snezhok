import Fastify from "fastify";
import { writeFile } from "node:fs/promises";

import { config } from "./config.js";
import { pool } from "./db/pool.js";
import { startActivityScheduler } from "./modules/activities/scheduler.js";
import { startCallMediaControlWorker } from "./modules/calls/mediaControl.js";
import { startPushDeliveryWorker } from "./modules/notifications/pushWorker.js";
import { startScheduledMessageDelivery } from "./modules/productivity/scheduler.js";
import { startReliabilityMaintenance } from "./modules/reliability/cleanup.js";

const host = Fastify({
  logger: {
    redact: {
      paths: ["*.authorization", "*.cookie", "*.token", "*.payload", "*.privateKey"],
      censor: "[REDACTED]",
    },
  },
});
if (config.RUNTIME_ROLE !== "job-worker") throw new Error(`Refusing to start job worker with RUNTIME_ROLE=${config.RUNTIME_ROLE}`);
const log = host.log;
const stops = [
  startScheduledMessageDelivery(log),
  startPushDeliveryWorker(log),
  startReliabilityMaintenance(log),
  startCallMediaControlWorker(log),
  startActivityScheduler(log),
];

const heartbeat = async () => {
  await pool.query(
    `INSERT INTO worker_heartbeats(worker_name,instance_id,source_revision)
     VALUES ('domain-jobs',$1,$2)
     ON CONFLICT(worker_name) DO UPDATE SET instance_id=EXCLUDED.instance_id,source_revision=EXCLUDED.source_revision,
       started_at=CASE WHEN worker_heartbeats.instance_id=EXCLUDED.instance_id THEN worker_heartbeats.started_at ELSE now() END,last_seen_at=now()`,
    [config.JOB_WORKER_ID, config.SOURCE_REVISION],
  );
  await writeFile("/tmp/snezhok-job-worker-heartbeat", String(Date.now()), { encoding: "utf8" });
};
await heartbeat();
let heartbeatActive = false;
const refreshHeartbeat = async () => {
  if (heartbeatActive || stopping) return;
  heartbeatActive = true;
  try {
    await heartbeat();
  } catch (error) {
    log.error({ err: error }, "job worker heartbeat failed");
  } finally {
    heartbeatActive = false;
  }
};
const heartbeatTimer = setInterval(() => void refreshHeartbeat(), 5_000);
log.info({ workerId: config.JOB_WORKER_ID, revision: config.SOURCE_REVISION }, "domain job worker started");

let stopping = false;
async function stop(signal: string) {
  if (stopping) return;
  stopping = true;
  log.info({ signal }, "domain job worker shutdown started");
  clearInterval(heartbeatTimer);
  for (const stopWorker of stops) stopWorker();
  await pool.end();
  await host.close();
}
process.on("SIGTERM", () => void stop("SIGTERM"));
process.on("SIGINT", () => void stop("SIGINT"));
