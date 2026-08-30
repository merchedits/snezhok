import type { FastifyBaseLogger } from "fastify";
import { transaction } from "../../db/pool.js";
import { newId } from "../../lib/ids.js";
import { publishStoredEvent, storeEvent, type StoredEvent } from "../realtime/events.js";
import { createMilestoneEventsForActivity, personalizedActivityMessages } from "./service.js";
import { EXPIRING_GAME_TYPES, inactiveGameCutoff } from "./activityExpiry.js";

export async function publishReadyActivityCollages() {
  return transaction(async (client) => {
    const ready = await client.query<{ id: string; activity_id: string; conversation_id: string; anchor_message_id: string }>(
      `SELECT entry.id,activity.id activity_id,activity.conversation_id,activity.anchor_message_id
         FROM cooperative_activity_entries entry
         JOIN cooperative_activities activity ON activity.id=entry.activity_id AND activity.type='color-hunt'
         JOIN cooperative_activity_attachments link ON link.entry_id=entry.id
         JOIN attachments attachment ON attachment.id=link.attachment_id AND attachment.status='ready' AND attachment.blob_id IS NOT NULL
        WHERE entry.kind='collage' AND coalesce((entry.payload->>'published')::boolean,false)=false
          AND activity.anchor_message_id IS NOT NULL
        ORDER BY entry.created_at,entry.id LIMIT 25 FOR UPDATE OF entry SKIP LOCKED`,
    );
    const events: StoredEvent[] = [];
    for (const entry of ready.rows) {
      await client.query("UPDATE cooperative_activity_entries SET payload=payload||'{\"published\":true}'::jsonb,updated_at=now() WHERE id=$1", [entry.id]);
      await client.query("UPDATE cooperative_activities SET revision=revision+1,updated_at=now() WHERE id=$1", [entry.activity_id]);
      const recipients = (await client.query<{ user_id: string }>("SELECT user_id FROM conversation_members WHERE conversation_id=$1", [entry.conversation_id])).rows.map((row) => row.user_id);
      const messages = await personalizedActivityMessages(client, entry.anchor_message_id, recipients);
      events.push(await storeEvent(client, recipients, "message:updated", (recipientId) => messages.get(recipientId)!));
    }
    return events;
  });
}

export async function revealDueMemoryCapsules() {
  return transaction(async (client) => {
    const due = await client.query<{ id: string; conversation_id: string; anchor_message_id: string; created_by: string }>(
      `SELECT id,conversation_id,anchor_message_id,created_by FROM cooperative_activities
       WHERE type='memory-capsule' AND state='locked' AND reveal_at<=now() AND anchor_message_id IS NOT NULL
       ORDER BY reveal_at,id LIMIT 25 FOR UPDATE SKIP LOCKED`,
    );
    const events: StoredEvent[] = [];
    for (const activity of due.rows) {
      const revision = (await client.query<{ revision: string }>(
        `UPDATE cooperative_activities SET state='completed',completed_at=now(),revision=revision+1,updated_at=now()
         WHERE id=$1 AND state='locked' RETURNING revision::text`,
        [activity.id],
      )).rows[0];
      if (!revision) continue;
      await client.query("UPDATE cooperative_activity_participants SET status='completed',updated_at=now() WHERE activity_id=$1", [activity.id]);
      await client.query(
        "INSERT INTO cooperative_activity_events(id,activity_id,actor_id,action,revision,metadata) VALUES ($1,$2,NULL,'revealed',$3,'{}')",
        [newId(), activity.id, Number(revision.revision)],
      );
      const recipients = (await client.query<{ user_id: string }>("SELECT user_id FROM conversation_members WHERE conversation_id=$1", [activity.conversation_id])).rows.map((row) => row.user_id);
      const messages = await personalizedActivityMessages(client, activity.anchor_message_id, recipients);
      events.push(await storeEvent(client, recipients, "message:updated", (recipientId) => messages.get(recipientId)!));
      events.push(...await createMilestoneEventsForActivity(client, activity.id, activity.created_by, recipients));
    }
    return events;
  });
}

export async function expireInactiveGames() {
  return transaction(async (client) => {
    const due = await client.query<{ id: string; conversation_id: string; anchor_message_id: string }>(
      `SELECT id,conversation_id,anchor_message_id FROM cooperative_activities
       WHERE type=ANY($1::text[]) AND state IN ('active','waiting') AND updated_at<=$2 AND anchor_message_id IS NOT NULL
       ORDER BY updated_at,id LIMIT 25 FOR UPDATE SKIP LOCKED`,
      [[...EXPIRING_GAME_TYPES], inactiveGameCutoff()],
    );
    const events: StoredEvent[] = [];
    for (const activity of due.rows) {
      const revision = (await client.query<{ revision: string }>(
        `UPDATE cooperative_activities SET state='expired',completed_at=now(),revision=revision+1,updated_at=now()
         WHERE id=$1 AND state IN ('active','waiting') RETURNING revision::text`,
        [activity.id],
      )).rows[0];
      if (!revision) continue;
      await client.query("UPDATE cooperative_activity_participants SET status='completed',updated_at=now() WHERE activity_id=$1", [activity.id]);
      await client.query(
        "INSERT INTO cooperative_activity_events(id,activity_id,actor_id,action,revision,metadata) VALUES ($1,$2,NULL,'expired',$3,$4)",
        [newId(), activity.id, Number(revision.revision), { reason: "inactive-24h" }],
      );
      const recipients = (await client.query<{ user_id: string }>("SELECT user_id FROM conversation_members WHERE conversation_id=$1", [activity.conversation_id])).rows.map((row) => row.user_id);
      const messages = await personalizedActivityMessages(client, activity.anchor_message_id, recipients);
      events.push(await storeEvent(client, recipients, "message:updated", (recipientId) => messages.get(recipientId)!));
    }
    return events;
  });
}

export function startActivityScheduler(logger: FastifyBaseLogger) {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      const [capsules, collages, expiredGames] = await Promise.all([revealDueMemoryCapsules(), publishReadyActivityCollages(), expireInactiveGames()]);
      [...capsules, ...collages, ...expiredGames].forEach(publishStoredEvent);
    } catch (error) {
      logger.error({ err: error }, "cooperative activity scheduler failed");
    } finally {
      running = false;
    }
  };
  void run();
  const timer = setInterval(() => void run(), 5_000);
  timer.unref();
  return () => clearInterval(timer);
}
