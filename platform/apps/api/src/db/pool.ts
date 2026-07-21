import pg from "pg";
import { config } from "../config.js";

const { Pool } = pg;

export const pool = new Pool({
  ...(config.DATABASE_HOST ? {
    host: config.DATABASE_HOST,
    port: config.DATABASE_PORT,
    database: config.DATABASE_NAME,
    user: config.DATABASE_USER,
    password: config.DATABASE_PASSWORD,
  } : { connectionString: config.DATABASE_URL }),
  max: config.DATABASE_POOL_MAX,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  statement_timeout: config.DATABASE_STATEMENT_TIMEOUT_MS,
  query_timeout: config.DATABASE_QUERY_TIMEOUT_MS,
  idle_in_transaction_session_timeout: config.DATABASE_IDLE_TRANSACTION_TIMEOUT_MS,
  application_name: "snezhok-api",
});

pool.on("error", (error) => console.error("Unexpected PostgreSQL pool error", error));

export type DbClient = pg.PoolClient;

export async function transaction<T>(work: (client: DbClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function readSnapshot<T>(work: (client: DbClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
