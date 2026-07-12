import { pool } from "./database.js";
import { runWorker } from "./worker.js";

const controller = new AbortController();
for (const event of ["SIGINT", "SIGTERM"] as const) process.once(event, () => controller.abort());

runWorker(controller.signal)
  .then(() => pool.end())
  .catch(async (error) => { console.error("Media worker stopped", error); await pool.end().catch(() => undefined); process.exitCode = 1; });
