import { setTimeout as delay } from "node:timers/promises";
import { config } from "./config.js";
import { callsAreActive, cancellationRequested, claimJob, completeJob, failJob, heartbeat, recoverInterruptedJobs } from "./database.js";
import { processMedia } from "./processors.js";
import { commitOutput, createJobDirectory, hostHasCapacity, objectPath, removeJobDirectory } from "./storage.js";

export async function runWorker(signal: AbortSignal) {
  await recoverInterruptedJobs();
  while (!signal.aborted) {
    let job;
    try {
      if (!hostHasCapacity() || await callsAreActive()) { await delay(config.POLL_INTERVAL_MS, undefined, { signal }).catch(() => undefined); continue; }
      job = await claimJob();
    } catch (error) {
      console.error("Media worker polling failed", error);
      await delay(config.POLL_INTERVAL_MS, undefined, { signal }).catch(() => undefined); continue;
    }
    if (!job) { await delay(config.POLL_INTERVAL_MS, undefined, { signal }).catch(() => undefined); continue; }
    const controller = new AbortController();
    const stop = () => controller.abort(); signal.addEventListener("abort", stop, { once: true });
    const cancellationPoll = setInterval(() => void Promise.all([cancellationRequested(job.id), callsAreActive()]).then(([cancelled, activeCall]) => {
      if (cancelled || activeCall || !hostHasCapacity()) controller.abort();
    }).catch(() => controller.abort()), 2_000); cancellationPoll.unref();
    let directory: string | null = null;
    try {
      directory = await createJobDirectory(job.id);
      const outputs = await processMedia(job, objectPath(job.originalStorageKey), directory, { signal: controller.signal, heartbeat: () => heartbeat(job.id) });
      const committed = [];
      for (const output of outputs) committed.push({ ...output, ...(await commitOutput(output.path)), blobId: "" });
      // commitOutput's id is the proposed blob ID; database deduplication may choose an existing blob.
      await completeJob(job, committed.map(({ id, ...output }) => ({ ...output, blobId: id })));
    } catch (error) {
      await failJob(job, error);
    } finally {
      clearInterval(cancellationPoll); signal.removeEventListener("abort", stop); if (directory) await removeJobDirectory(directory);
    }
  }
}
