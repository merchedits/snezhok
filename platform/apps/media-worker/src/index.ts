import { pool } from "./database.js";
import { runWorker } from "./worker.js";

const controller = new AbortController();
for (const event of ["SIGINT", "SIGTERM"] as const) process.once(event, () => controller.abort());

runWorker(controller.signal)
  .then(() => pool.end())
  .catch(async (error) => { console.error(JSON.stringify({ event: "media_worker_stopped", errorName: error instanceof Error ? error.name : "UnknownError" })); await pool.end().catch(() => undefined); process.exitCode = 1; });
