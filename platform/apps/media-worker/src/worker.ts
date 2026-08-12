import { setTimeout as delay } from "node:timers/promises";
import { writeFile } from "node:fs/promises";
import { config } from "./config.js";
import { callsAreActive, cancellationRequested, claimJob, completeJob, failJob, heartbeat, recoverInterruptedJobs } from "./database.js";
import { processMedia } from "./processors.js";
import { commitOutput, createJobDirectory, hostHasCapacity, objectPath, removeCommittedOutput, removeJobDirectory } from "./storage.js";

export async function runWorker(signal: AbortSignal) {
  await recoverInterruptedJobs();
  while (!signal.aborted) {
    let job;
    try {
      if (!hostHasCapacity()) { await markWorkerHealthy(); await delay(config.POLL_INTERVAL_MS, undefined, { signal }).catch(() => undefined); continue; }
      if (await callsAreActive()) { await markWorkerHealthy(); await delay(config.POLL_INTERVAL_MS, undefined, { signal }).catch(() => undefined); continue; }
      job = await claimJob();
      await markWorkerHealthy();
    } catch (error) {
      console.error(JSON.stringify({ event: "media_worker_poll_failed", errorName: error instanceof Error ? error.name : "UnknownError" }));
      await delay(config.POLL_INTERVAL_MS, undefined, { signal }).catch(() => undefined); continue;
    }
    if (!job) { await delay(config.POLL_INTERVAL_MS, undefined, { signal }).catch(() => undefined); continue; }
    const controller = new AbortController();
    const stop = () => controller.abort(); signal.addEventListener("abort", stop, { once: true });
    const cancellationPoll = setInterval(() => void Promise.all([cancellationRequested(job.id), callsAreActive()]).then(([cancelled, activeCall]) => {
      if (cancelled || activeCall || !hostHasCapacity()) controller.abort();
    }).catch(() => controller.abort()), 2_000); cancellationPoll.unref();
    let directory: string | null = null;
    const startedAt = performance.now();
    try {
      directory = await createJobDirectory(job.id);
      const outputs = await processMedia(job, job.originalStorageKey ? objectPath(job.originalStorageKey) : "", directory, { signal: controller.signal, heartbeat: () => heartbeat(job.id), collageInputs: job.sourceStorageKeys.map(objectPath) });
      const committed = [];
      for (const output of outputs) committed.push({ ...output, ...(await commitOutput(output.path)), blobId: "" });
      // commitOutput's id is the proposed blob ID; database deduplication may choose an existing blob.
      const unusedStorageKeys = await completeJob(job, committed.map(({ id, ...output }) => ({ ...output, blobId: id })));
      await Promise.allSettled(unusedStorageKeys.map(removeCommittedOutput));
      console.info(JSON.stringify({ event: "media_job_complete", jobId: job.id, kind: job.kind, purpose: job.purpose, profile: job.profile, inputBytes: job.originalBytes, outputBytes: committed.reduce((sum, output) => sum + output.bytes, 0), durationMs: Math.round(performance.now() - startedAt), attempts: job.attempts }));
    } catch (error) {
      console.warn(JSON.stringify({ event: "media_job_failed", jobId: job.id, kind: job.kind, purpose: job.purpose, profile: job.profile, inputBytes: job.originalBytes, durationMs: Math.round(performance.now() - startedAt), attempts: job.attempts, errorName: error instanceof Error ? error.name : "UnknownError" }));
      await failJob(job, error);
    } finally {
      clearInterval(cancellationPoll); signal.removeEventListener("abort", stop); if (directory) await removeJobDirectory(directory);
    }
  }
}

const processHeartbeatPath = process.env.WORKER_HEARTBEAT_PATH ?? "/tmp/snezhok-media-worker-heartbeat";
let lastProcessHeartbeat = 0;
async function markWorkerHealthy() {
  if (Date.now() - lastProcessHeartbeat < 5_000) return;
  lastProcessHeartbeat = Date.now();
  await writeFile(processHeartbeatPath, String(lastProcessHeartbeat), { mode: 0o600 }).catch(() => undefined);
}
