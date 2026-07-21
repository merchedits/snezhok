import pg from "pg";

const userId = process.env.ADMIN_BOOTSTRAP_USER_ID?.trim() ?? "";
if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)) {
  throw new Error("ADMIN_BOOTSTRAP_USER_ID must identify an existing user by UUID");
}
for (const name of ["DATABASE_HOST", "DATABASE_NAME", "DATABASE_USER", "DATABASE_PASSWORD"] as const) {
  if (!process.env[name]) throw new Error(`${name} is required`);
}

const pool = new pg.Pool({
  host: process.env.DATABASE_HOST,
  port: Number(process.env.DATABASE_PORT ?? 5432),
  database: process.env.DATABASE_NAME,
  user: process.env.DATABASE_USER,
  password: process.env.DATABASE_PASSWORD,
  max: 1,
  application_name: "snezhok-admin-bootstrap",
});
const client = await pool.connect();
try {
  await client.query("BEGIN");
  await client.query("SELECT pg_advisory_xact_lock($1)", [492_001_732]);
  const promoted = await client.query<{ username: string }>(
    "UPDATE users SET is_admin=true,updated_at=now() WHERE id=$1 AND deleted_at IS NULL RETURNING username",
    [userId],
  );
  if (!promoted.rowCount) throw new Error("ADMIN_BOOTSTRAP_USER_ID does not identify an active account");
  await client.query(
    "INSERT INTO global_admin_audit_log(actor_id,action,target_user_id,metadata) VALUES ($1,'administrator.bootstrapped',$1,$2)",
    [userId, { mechanism: "explicit-existing-user-id" }],
  );
  await client.query("COMMIT");
  process.stdout.write(`administrator bootstrap completed for ${promoted.rows[0]!.username}\n`);
} catch (error) {
  await client.query("ROLLBACK").catch(() => undefined);
  throw error;
} finally {
  client.release();
  await pool.end();
}
