import type { MessageKind } from "@snezhok/contracts";
import { pool } from "../../db/pool.js";
import { createMessage } from "../messages/service.js";
import { expireWaitingDispatchesSql, recoverWaitingDispatchesSql } from "../uploads/waitingDispatch.js";

interface ScheduledRow {
  id: string;
  user_id: string;
  stream_id: string;
  client_id: string;
  kind: Exclude<MessageKind, "system">;
  text: string;
  reply_to_id: string | null;
  attachment_ids: string[];
  silent: boolean;
  attempts: number;
}

export function startScheduledMessageDelivery(log: { info: (fields: object, message: string) => void; error: (fields: object, message: string) => void }): () => void {
  let stopped = false;
  let active = false;
  void pool.query("UPDATE scheduled_messages SET status='pending',updated_at=now() WHERE status='delivering' AND updated_at<now()-interval '5 minutes'")
    .catch((error) => log.error({ error }, "scheduled message recovery failed; delivery poll will retry"));
  void recoverWaitingAttachmentDispatches()
    .catch((error) => log.error({ error }, "waiting attachment dispatch recovery failed; delivery poll will retry"));

  const deliver = async () => {
    if (stopped || active) return;
    active = true;
    try {
      await recoverWaitingAttachmentDispatches();
      const due = await pool.query<ScheduledRow>(
        `UPDATE scheduled_messages scheduled SET status='delivering',attempts=attempts+1,updated_at=now()
         FROM (SELECT id FROM scheduled_messages WHERE status='pending' AND scheduled_for<=now() ORDER BY scheduled_for,id LIMIT 20 FOR UPDATE SKIP LOCKED) ready
         WHERE scheduled.id=ready.id
         RETURNING scheduled.id,scheduled.user_id,scheduled.stream_id,scheduled.client_id,scheduled.kind,scheduled.text,scheduled.reply_to_id,scheduled.attachment_ids,scheduled.silent,scheduled.attempts`,
      );
      for (const scheduled of due.rows) await deliverOne(scheduled, log);
    } catch (error) {
      log.error({ error }, "scheduled message delivery poll failed");
    } finally {
      active = false;
    }
  };
  const timer = setInterval(() => void deliver(), 1_000);
  timer.unref();
  void deliver();
  return () => { stopped = true; clearInterval(timer); };
}

export async function recoverWaitingAttachmentDispatches(): Promise<void> {
  await pool.query(expireWaitingDispatchesSql);
  await pool.query(recoverWaitingDispatchesSql);
}

async function deliverOne(scheduled: ScheduledRow, log: { info: (fields: object, message: string) => void; error: (fields: object, message: string) => void }) {
  try {
    await createMessage(scheduled.user_id, scheduled.stream_id, {
      clientId: scheduled.client_id,
      kind: scheduled.kind,
      text: scheduled.text,
      replyToId: scheduled.reply_to_id,
      attachmentIds: scheduled.attachment_ids,
      silent: scheduled.silent,
    });
    await pool.query("UPDATE scheduled_messages SET status='delivered',last_error=NULL,updated_at=now() WHERE id=$1", [scheduled.id]);
    log.info({ scheduledMessageId: scheduled.id, attempts: scheduled.attempts }, "scheduled message delivered");
  } catch (error) {
    const failed = scheduled.attempts >= 5;
    const retrySeconds = Math.min(3_600, 5 * (2 ** Math.max(0, scheduled.attempts - 1)));
    await pool.query(
      "UPDATE scheduled_messages SET status=$2,last_error=$3,scheduled_for=CASE WHEN $2='pending' THEN now()+($4::text||' seconds')::interval ELSE scheduled_for END,updated_at=now() WHERE id=$1",
      [scheduled.id, failed ? "failed" : "pending", error instanceof Error ? error.message.slice(0, 500) : "Scheduled delivery failed", retrySeconds],
    );
    log.error({ scheduledMessageId: scheduled.id, attempts: scheduled.attempts, failed, error }, "scheduled message delivery failed");
  }
}
