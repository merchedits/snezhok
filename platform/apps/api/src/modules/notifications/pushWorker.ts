import { pool, transaction } from "../../db/pool.js";
import { incrementMetric } from "../../lib/metrics.js";
import {
  fetchExpoReceipts,
  PushGatewayError,
  pushMessageForEvent,
  sendExpoPush,
} from "./push.js";

interface WorkerLog {
  info: (fields: object, message: string) => void;
  warn: (fields: object, message: string) => void;
  error: (fields: object, message: string) => void;
}

interface OutboxRow {
  id: string;
  user_id: string;
  event_name: string;
  payload: unknown;
  attempts: number;
}

interface TargetRow {
  id: string;
  outbox_id: string;
  push_device_id: string | null;
  expo_push_token: string;
  user_id: string;
  event_name: string;
  payload: unknown;
  device_enabled: boolean;
  attempts: number;
}

interface ReceiptRow {
  ticket_id: string;
  target_id: string;
  outbox_id: string;
  expo_push_token: string;
  attempts: number;
}

const MAX_ATTEMPTS = 8;

/**
 * Durable, restart-safe push delivery. PostgreSQL NOTIFY remains only a low
 * latency hint for connected sockets; this worker owns all external push I/O.
 */
export function startPushDeliveryWorker(log: WorkerLog): () => void {
  let stopped = false;
  let active = false;
  let ticks = 0;
  void recoverAbandonedClaims().catch((error) => log.error({ error }, "push claim recovery failed; worker poll will retry"));

  const poll = async () => {
    if (stopped || active) return;
    active = true;
    try {
      await expandPendingOutbox(log);
      await deliverPendingTargets(log);
      await finalizeExpandedOutbox();
      ticks += 1;
      if (ticks % 30 === 0) await checkPendingReceipts(log);
      if (ticks % 300 === 0) await recoverAbandonedClaims();
    } catch (error) {
      incrementMetric("push.worker.failed");
      log.error({ error }, "push delivery poll failed");
    } finally {
      active = false;
    }
  };

  const timer = setInterval(() => void poll(), 1_000);
  timer.unref();
  void poll();
  return () => { stopped = true; clearInterval(timer); };
}

async function expandPendingOutbox(log: WorkerLog): Promise<void> {
  const claimed = await pool.query<OutboxRow>(
    `UPDATE push_delivery_outbox outbox
     SET status='processing',attempts=attempts+1,locked_at=now(),updated_at=now()
     FROM (
       SELECT id FROM push_delivery_outbox
       WHERE status='pending' AND available_at<=now()
       ORDER BY available_at,id LIMIT 20 FOR UPDATE SKIP LOCKED
     ) ready
     WHERE outbox.id=ready.id
     RETURNING outbox.id::text,outbox.user_id,outbox.event_name,outbox.payload,outbox.attempts`,
  );
  for (const outbox of claimed.rows) {
    try {
      const message = await pushMessageForEvent(outbox.user_id, outbox.event_name, outbox.payload);
      if (!message) {
        await pool.query("UPDATE push_delivery_outbox SET status='skipped',completed_at=now(),locked_at=NULL,updated_at=now() WHERE id=$1 AND status='processing'", [outbox.id]);
        incrementMetric("push.outbox.skipped");
        continue;
      }
      const devices = await pool.query<{ id: string; expo_push_token: string }>(
        "SELECT id,expo_push_token FROM push_devices WHERE user_id=$1 AND enabled ORDER BY id",
        [outbox.user_id],
      );
      if (!devices.rowCount) {
        await pool.query("UPDATE push_delivery_outbox SET status='skipped',completed_at=now(),locked_at=NULL,updated_at=now() WHERE id=$1 AND status='processing'", [outbox.id]);
        incrementMetric("push.outbox.no_devices");
        continue;
      }
      await transaction(async (client) => {
        for (const device of devices.rows) {
          await client.query(
            `INSERT INTO push_delivery_targets(outbox_id,push_device_id,expo_push_token)
             VALUES ($1,$2,$3) ON CONFLICT(outbox_id,expo_push_token) DO NOTHING`,
            [outbox.id, device.id, device.expo_push_token],
          );
        }
        await client.query("UPDATE push_delivery_outbox SET status='expanded',locked_at=NULL,last_error=NULL,updated_at=now() WHERE id=$1 AND status='processing'", [outbox.id]);
      });
      incrementMetric("push.outbox.expanded");
    } catch (error) {
      await retryOutbox(outbox, error);
      log.warn({ outboxId: outbox.id, attempts: outbox.attempts, error }, "push outbox expansion failed");
    }
  }
}

async function deliverPendingTargets(log: WorkerLog): Promise<void> {
  const claimed = await pool.query<TargetRow>(
    `UPDATE push_delivery_targets target
     SET status='processing',attempts=attempts+1,locked_at=now(),updated_at=now()
     FROM (
       SELECT id FROM push_delivery_targets
       WHERE status='pending' AND available_at<=now()
       ORDER BY available_at,id LIMIT 20 FOR UPDATE SKIP LOCKED
     ) ready
     WHERE target.id=ready.id
     RETURNING target.id::text,target.outbox_id::text,target.push_device_id,target.expo_push_token,target.attempts,
       (SELECT outbox.user_id FROM push_delivery_outbox outbox WHERE outbox.id=target.outbox_id) user_id,
       (SELECT outbox.event_name FROM push_delivery_outbox outbox WHERE outbox.id=target.outbox_id) event_name,
       (SELECT outbox.payload FROM push_delivery_outbox outbox WHERE outbox.id=target.outbox_id) payload,
       coalesce((SELECT device.enabled FROM push_devices device WHERE device.id=target.push_device_id),false) device_enabled`,
  );
  for (const target of claimed.rows) {
    try {
      const message = target.device_enabled ? await pushMessageForEvent(target.user_id, target.event_name, target.payload) : null;
      if (!message) {
        await pool.query("UPDATE push_delivery_targets SET status='skipped',locked_at=NULL,last_error=NULL,updated_at=now() WHERE id=$1 AND status='processing'", [target.id]);
        incrementMetric("push.delivery.skipped");
        continue;
      }
      const ticketId = await sendExpoPush(target.expo_push_token, message);
      await transaction(async (client) => {
        await client.query(
          "UPDATE push_delivery_targets SET status='delivered',delivered_at=now(),locked_at=NULL,last_error=NULL,updated_at=now() WHERE id=$1 AND status='processing'",
          [target.id],
        );
        if (ticketId) {
          await client.query(
            `INSERT INTO push_receipts(ticket_id,target_id,expo_push_token)
             VALUES ($1,$2,$3) ON CONFLICT(ticket_id) DO NOTHING`,
            [ticketId, target.id, target.expo_push_token],
          );
        }
      });
      incrementMetric("push.delivery.sent");
    } catch (error) {
      const gatewayError = error instanceof PushGatewayError ? error : new PushGatewayError(error instanceof Error ? error.message : "Push delivery failed", true);
      if (gatewayError.code === "DeviceNotRegistered" || gatewayError.code === "InvalidPushToken") {
        await pool.query("UPDATE push_devices SET enabled=false WHERE expo_push_token=$1", [target.expo_push_token]);
      }
      await retryTarget(target, gatewayError);
      incrementMetric(gatewayError.retryable ? "push.delivery.retry" : "push.delivery.rejected");
      log.warn({ targetId: target.id, attempts: target.attempts, code: gatewayError.code, error }, "push target delivery failed");
    }
  }
}

async function finalizeExpandedOutbox(): Promise<void> {
  await pool.query(
    `UPDATE push_delivery_outbox outbox
     SET status=CASE WHEN EXISTS(
       SELECT 1 FROM push_delivery_targets target WHERE target.outbox_id=outbox.id AND target.status='failed'
     ) THEN 'failed' ELSE 'delivered' END,
     completed_at=now(),updated_at=now()
     WHERE outbox.status='expanded'
       AND EXISTS(SELECT 1 FROM push_delivery_targets target WHERE target.outbox_id=outbox.id)
       AND NOT EXISTS(
         SELECT 1 FROM push_delivery_targets target
         WHERE target.outbox_id=outbox.id AND target.status IN ('pending','processing')
       )`,
  );
}

async function checkPendingReceipts(log: WorkerLog): Promise<void> {
  const claimed = await pool.query<ReceiptRow>(
    `UPDATE push_receipts receipt
     SET status='processing',attempts=attempts+1,locked_at=now(),updated_at=now()
     FROM (
       SELECT ticket_id FROM push_receipts
       WHERE status='pending' AND available_at<=now()
       ORDER BY available_at,ticket_id LIMIT 100 FOR UPDATE SKIP LOCKED
     ) ready
     WHERE receipt.ticket_id=ready.ticket_id
     RETURNING receipt.ticket_id,receipt.target_id::text,receipt.expo_push_token,receipt.attempts,
       (SELECT target.outbox_id::text FROM push_delivery_targets target WHERE target.id=receipt.target_id) outbox_id`,
  );
  if (!claimed.rowCount) return;
  try {
    const receipts = await fetchExpoReceipts(claimed.rows.map((row) => row.ticket_id));
    for (const row of claimed.rows) {
      const receipt = receipts[row.ticket_id];
      if (!receipt) {
        await retryReceipt(row, new PushGatewayError("Push receipt is not available yet", true));
        continue;
      }
      if (receipt.details?.error === "DeviceNotRegistered") {
        await pool.query("UPDATE push_devices SET enabled=false WHERE expo_push_token=$1", [row.expo_push_token]);
      }
      const providerError = receipt.status === "error" ? (receipt.message ?? receipt.details?.error ?? "Provider reported a delivery error").slice(0, 500) : null;
      await transaction(async (client) => {
        await client.query(
          "UPDATE push_receipts SET status='checked',checked_at=now(),locked_at=NULL,last_error=$2,updated_at=now() WHERE ticket_id=$1",
          [row.ticket_id, providerError],
        );
        if (providerError) {
          await client.query("UPDATE push_delivery_targets SET status='failed',last_error=$2,updated_at=now() WHERE id=$1", [row.target_id, providerError]);
          await client.query("UPDATE push_delivery_outbox SET status='failed',last_error=$2,updated_at=now() WHERE id=$1", [row.outbox_id, providerError]);
        }
      });
      incrementMetric(receipt.status === "error" ? "push.receipt.error" : "push.receipt.ok");
    }
  } catch (error) {
    for (const row of claimed.rows) await retryReceipt(row, error);
    log.warn({ count: claimed.rowCount, error }, "push receipt check failed");
  }
}

async function retryOutbox(row: OutboxRow, error: unknown): Promise<void> {
  const failed = row.attempts >= MAX_ATTEMPTS;
  await pool.query(
    `UPDATE push_delivery_outbox SET status=$2,available_at=CASE WHEN $2='pending' THEN now()+($3::text||' seconds')::interval ELSE available_at END,
       locked_at=NULL,last_error=$4,completed_at=CASE WHEN $2='failed' THEN now() ELSE completed_at END,updated_at=now()
     WHERE id=$1 AND status='processing'`,
    [row.id, failed ? "failed" : "pending", retryDelaySeconds(row.attempts), errorMessage(error)],
  );
}

async function retryTarget(row: TargetRow, error: PushGatewayError): Promise<void> {
  const failed = !error.retryable || row.attempts >= MAX_ATTEMPTS;
  await pool.query(
    `UPDATE push_delivery_targets SET status=$2,available_at=CASE WHEN $2='pending' THEN now()+($3::text||' seconds')::interval ELSE available_at END,
       locked_at=NULL,last_error=$4,updated_at=now() WHERE id=$1 AND status='processing'`,
    [row.id, failed ? "failed" : "pending", retryDelaySeconds(row.attempts), errorMessage(error)],
  );
}

async function retryReceipt(row: ReceiptRow, error: unknown): Promise<void> {
  const failed = row.attempts >= MAX_ATTEMPTS;
  await pool.query(
    `UPDATE push_receipts SET status=$2,available_at=CASE WHEN $2='pending' THEN now()+($3::text||' seconds')::interval ELSE available_at END,
       locked_at=NULL,last_error=$4,updated_at=now() WHERE ticket_id=$1 AND status='processing'`,
    [row.ticket_id, failed ? "failed" : "pending", Math.max(300, retryDelaySeconds(row.attempts)), errorMessage(error)],
  );
}

async function recoverAbandonedClaims(): Promise<void> {
  await Promise.all([
    pool.query("UPDATE push_delivery_outbox SET status='pending',locked_at=NULL,updated_at=now() WHERE status='processing' AND locked_at<now()-interval '5 minutes'"),
    pool.query("UPDATE push_delivery_targets SET status='pending',locked_at=NULL,updated_at=now() WHERE status='processing' AND locked_at<now()-interval '5 minutes'"),
    pool.query("UPDATE push_receipts SET status='pending',locked_at=NULL,updated_at=now() WHERE status='processing' AND locked_at<now()-interval '5 minutes'"),
  ]);
}

export function retryDelaySeconds(attempt: number): number {
  return Math.min(3_600, 5 * (2 ** Math.max(0, attempt - 1)));
}

function errorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : "Push delivery failed").slice(0, 500);
}
