import { buildApp } from "./app.js";
import { config } from "./config.js";
import { migrate } from "./db/migrate.js";
import { pool } from "./db/pool.js";
import { setupRealtime } from "./modules/realtime/socket.js";

await migrate();
const app = await buildApp();
const io = await setupRealtime(app.server);

await app.listen({ host: config.HOST, port: config.PORT });

let stopping = false;
async function stop(signal: string) {
  if (stopping) return; stopping = true;
  app.log.info({ signal }, "graceful shutdown started");
  await new Promise<void>((resolve) => io.close(() => resolve()));
  await app.close(); await pool.end();
}
process.on("SIGTERM", () => void stop("SIGTERM"));
process.on("SIGINT", () => void stop("SIGINT"));
