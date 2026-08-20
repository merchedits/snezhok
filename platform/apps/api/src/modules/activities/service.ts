import { randomInt } from "node:crypto";
import type { CooperativeActivity, CooperativeActivityType, Message } from "@snezhok/contracts";
import type { DbClient } from "../../db/pool.js";
import { pool, readSnapshot, transaction } from "../../db/pool.js";
import { conflict, forbidden, notFound } from "../../lib/errors.js";
import { deterministicId, newId } from "../../lib/ids.js";
import { getMessageById, getMessagesByIds } from "../messages/service.js";
import { publishStoredEvent, storeEvent, type StoredEvent } from "../realtime/events.js";
import { allocateMessageSequence, resolveStreamAccess, streamRecipients } from "../streams/access.js";
import { assertDirectConversationMessagingAllowed } from "../users/privacy.js";
import { initialActivityConfiguration } from "./prompts.js";
import { participantMayEditEntry, participantMaySubmit, selectionAfterEntryChange, type ActivityParticipantStatus } from "./policy.js";
import { colorHuntBatchLimit, combinedRating, memoryRevealDate, normalizeGuess, parseDrawingStrokes, validSongUrl } from "./rules.js";
import { getActivityView } from "./view.js";
import { applyAction } from "./actions.js";
import type { ActionResult, ActivityCommandInput, ActivityCreateInput, ActivityRow } from "./activityModel.js";

export async function createActivity(userId: string, conversationId: string, input: ActivityCreateInput) {
  if (input.type === "milestone") throw forbidden("Milestones are created automatically");
  const outcome = await transaction(async (client) => {
    const access = await resolveStreamAccess(userId, conversationId, client);
    if (access.streamKind !== "conversation") throw forbidden("Activities are available in private chats only");
    await assertDirectConversationMessagingAllowed(userId, conversationId, client);
    const conversation = (
      await client.query<{
        kind: "direct" | "group";
        participant_ids: string[];
      }>(
        `SELECT c.kind,array_agg(cm.user_id ORDER BY cm.joined_at,cm.user_id) participant_ids
       FROM conversations c JOIN conversation_members cm ON cm.conversation_id=c.id JOIN users u ON u.id=cm.user_id
       WHERE c.id=$1 AND u.deleted_at IS NULL GROUP BY c.id,c.kind`,
        [conversationId],
      )
    ).rows[0];
    if (!conversation || conversation.kind !== "direct" || conversation.participant_ids.length !== 2) throw conflict("Activities require a two-person private chat");
    let activityOptions = input.options;
    if (input.type === "question") {
      const consent = await client.query<{ count: string }>(
        `SELECT count(*)::text count FROM conversation_members cm JOIN user_settings us ON us.user_id=cm.user_id
         WHERE cm.conversation_id=$1 AND coalesce((us.settings->>'cooperativeMatureContent')::boolean,false)=true`,
        [conversationId],
      );
      const matureAllowed = Number(consent.rows[0]?.count ?? 0) === conversation.participant_ids.length;
      if ((input.options.category === "romantic" || input.options.category === "nsfw") && !matureAllowed) throw forbidden("Both people must enable mature cooperative prompts in Settings");
      activityOptions = { ...input.options, matureAllowed };
    }

    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`activity:${userId}:${input.clientId}`]);
    const duplicate = (await client.query<ActivityRow>(activityRowSql("WHERE ca.created_by=$1 AND ca.client_id=$2"), [userId, input.clientId])).rows[0];
    if (duplicate) {
      if (duplicate.conversation_id !== conversationId || duplicate.type !== input.type) throw conflict("Activity client ID was already used");
      if (!duplicate.anchor_message_id) throw conflict("Activity creation is still being finalized");
      return {
        message: await getMessageById(client, duplicate.anchor_message_id, userId),
        event: null,
      };
    }
    if (input.type === "movie-list" || input.type === "ideas-jar") {
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`activity-living:${conversationId}:${input.type}`]);
      const living = (await client.query<{ anchor_message_id: string }>("SELECT anchor_message_id FROM cooperative_activities WHERE conversation_id=$1 AND type=$2 AND state NOT IN ('cancelled','declined','expired') AND anchor_message_id IS NOT NULL ORDER BY created_at LIMIT 1", [conversationId, input.type])).rows[0];
      if (living)
        return {
          message: await getMessageById(client, living.anchor_message_id, userId),
          event: null,
        };
    }

    const activityId = newId();
    const configuration = initialActivityConfiguration(input.type, activityOptions, conversation.participant_ids);
    await client.query(
      `INSERT INTO cooperative_activities(id,conversation_id,created_by,client_id,type,config)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [activityId, conversationId, userId, input.clientId, input.type, configuration.config],
    );
    for (const participantId of conversation.participant_ids) {
      const privateState = (configuration.privateByUser as Record<string, Record<string, unknown>>)[participantId] ?? {};
      await client.query("INSERT INTO cooperative_activity_participants(activity_id,user_id,private_state) VALUES ($1,$2,$3)", [activityId, participantId, privateState]);
    }

    const messageId = newId();
    const sequence = await allocateMessageSequence(access, client);
    await client.query(
      `INSERT INTO messages(id,stream_kind,stream_id,sequence,sender_id,client_id,kind,text,silent)
       VALUES ($1,'conversation',$2,$3,$4,$5,'system',$6,false)`,
      [messageId, conversationId, sequence, userId, newId(), fallbackText(input.type)],
    );
    await client.query("UPDATE cooperative_activities SET anchor_message_id=$2,updated_at=now() WHERE id=$1", [activityId, messageId]);
    await client.query("INSERT INTO cooperative_activity_events(id,activity_id,actor_id,action,revision) VALUES ($1,$2,$3,'created',0)", [newId(), activityId, userId]);
    const recipients = await streamRecipients(access, client);
    const messages = await personalizedActivityMessages(client, messageId, recipients);
    const event = await storeEvent(client, recipients, "message:created", (recipientId) => messages.get(recipientId)!);
    return { message: messages.get(userId)!, event };
  });
  if (outcome.event) publishStoredEvent(outcome.event);
  return outcome.message;
}

export async function commandActivity(userId: string, activityId: string, input: ActivityCommandInput) {
  const outcome = await transaction(async (client) => {
    const row = (await client.query<ActivityRow>(activityRowSql("WHERE ca.id=$1 FOR UPDATE"), [activityId])).rows[0];
    if (!row) throw notFound("Activity not found");
    const membership = await client.query("SELECT 1 FROM cooperative_activity_participants WHERE activity_id=$1 AND user_id=$2", [activityId, userId]);
    if (!membership.rowCount) throw forbidden("You do not have access to this activity");
    const access = await resolveStreamAccess(userId, row.conversation_id, client);
    if (access.streamKind !== "conversation") throw forbidden();
    await assertDirectConversationMessagingAllowed(userId, row.conversation_id, client);

    const duplicate = await client.query<{ action: string }>("SELECT action FROM cooperative_activity_commands WHERE activity_id=$1 AND user_id=$2 AND client_id=$3", [activityId, userId, input.clientId]);
    if (duplicate.rowCount) {
      if (duplicate.rows[0]?.action !== input.action) throw conflict("Activity command ID was already used");
      return {
        message: await anchorMessage(client, row, userId),
        events: [] as StoredEvent[],
      };
    }
    if (Number(row.revision) !== input.expectedRevision) throw conflict("Activity changed; refresh and try again");
    if (["declined", "expired", "cancelled"].includes(row.state)) throw conflict("Activity is no longer active");
    if (row.state === "completed" && !["movie-list", "ideas-jar"].includes(row.type)) throw conflict("Activity is already complete");

    let result: ActionResult;
    if (input.action === "cancel") {
      if (row.created_by !== userId) throw forbidden("Only the person who started this activity can cancel it");
      result = { state: "cancelled" };
    } else if (input.action === "decline") {
      await client.query("UPDATE cooperative_activity_participants SET status='declined',updated_at=now() WHERE activity_id=$1 AND user_id=$2", [activityId, userId]);
      result = { state: "declined" };
    } else {
      result = await applyAction(client, row, userId, input.action, input.payload);
    }

    const nextRevision = Number(row.revision) + 1;
    await client.query(
      `UPDATE cooperative_activities SET state=coalesce($2,state),result=coalesce($3,result),reveal_at=coalesce($4,reveal_at),
       completed_at=CASE WHEN $5 THEN coalesce(completed_at,now()) ELSE completed_at END,revision=$6,updated_at=now() WHERE id=$1`,
      [activityId, result.state ?? null, result.result ?? null, result.revealAt ?? null, result.completed === true || result.state === "completed", nextRevision],
    );
    await client.query(`INSERT INTO cooperative_activity_commands(activity_id,user_id,client_id,action,resulting_revision) VALUES ($1,$2,$3,$4,$5)`, [activityId, userId, input.clientId, input.action, nextRevision]);
    await client.query(`INSERT INTO cooperative_activity_events(id,activity_id,actor_id,action,revision,metadata) VALUES ($1,$2,$3,$4,$5,$6)`, [newId(), activityId, userId, input.action, nextRevision, safeEventMetadata(input.payload)]);
    const recipients = await streamRecipients(access, client);
    const messageId = row.anchor_message_id;
    if (!messageId) throw conflict("Activity has no chat message");
    const messages = await personalizedActivityMessages(client, messageId, recipients);
    const event = await storeEvent(client, recipients, "message:updated", (recipientId) => messages.get(recipientId)!);
    const milestoneEvents = result.completed === true || result.state === "completed" || result.state === "locked" || row.type === "movie-list" ? await maybeCreateMilestoneEvents(client, row, userId, recipients) : [];
    return {
      message: messages.get(userId)!,
      events: [event, ...milestoneEvents],
    };
  });
  outcome.events.forEach(publishStoredEvent);
  return outcome.message;
}

export async function readActivity(userId: string, activityId: string) {
  return getActivityView(pool, activityId, userId);
}

export async function readActivityHistory(userId: string, conversationId: string) {
  return readSnapshot(async (client) => {
    const access = await resolveStreamAccess(userId, conversationId, client);
    if (access.streamKind !== "conversation") throw forbidden("Together history is available in private chats only");
    await assertDirectConversationMessagingAllowed(userId, conversationId, client);
    const anchors = await client.query<{ anchor_message_id: string }>(
      `SELECT ca.anchor_message_id
         FROM cooperative_activities ca
         JOIN messages anchor ON anchor.id=ca.anchor_message_id
        WHERE ca.conversation_id=$1
          AND ca.anchor_message_id IS NOT NULL
          AND anchor.deleted_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM hidden_messages hidden WHERE hidden.message_id=anchor.id AND hidden.user_id=$2)
          AND (ca.state IN ('completed','locked') OR ca.type IN ('movie-list','ideas-jar','milestone'))
        ORDER BY ca.updated_at DESC,ca.id DESC
        LIMIT 50`,
      [conversationId, userId],
    );
    return getMessagesByIds(
      client,
      anchors.rows.map((anchor) => anchor.anchor_message_id),
      userId,
    );
  });
}

export async function personalizedActivityMessages(client: DbClient, messageId: string, recipients: string[]) {
  const entries = await Promise.all(recipients.map(async (recipientId) => [recipientId, await getMessageById(client, messageId, recipientId)] as const));
  return new Map<string, Message>(entries);
}

async function maybeCreateMilestoneEvents(client: DbClient, completedActivity: ActivityRow, actorId: string, recipients: string[]) {
  const conversationId = completedActivity.conversation_id;
  const totals = (
    await client.query<{
      completed: string;
      questions: string;
      memories: string;
      watched: string;
    }>(
      `SELECT
      count(*) FILTER (WHERE ca.state='completed' AND ca.type<>'milestone')::text completed,
      count(*) FILTER (WHERE ca.state='completed' AND ca.type='question')::text questions,
      count(*) FILTER (WHERE ca.state IN ('locked','completed') AND ca.type='memory-capsule')::text memories,
      (SELECT count(*)::text FROM cooperative_activity_entries entry JOIN cooperative_activities list ON list.id=entry.activity_id
       WHERE list.conversation_id=$1 AND entry.kind='movie' AND entry.payload->>'status'='watched') watched
     FROM cooperative_activities ca WHERE ca.conversation_id=$1`,
      [conversationId],
    )
  ).rows[0];
  const candidates: Array<{ id: string; prompt: { ru: string; en: string } }> = [];
  if (Number(totals?.completed ?? 0) >= 1)
    candidates.push({
      id: "first-activity",
      prompt: {
        ru: "Вы сделали первую вещь вместе",
        en: "You made your first thing together",
      },
    });
  if (Number(totals?.questions ?? 0) >= 25)
    candidates.push({
      id: "questions-25",
      prompt: {
        ru: "25 вопросов получили два ответа",
        en: "You answered 25 questions together",
      },
    });
  if (Number(totals?.watched ?? 0) >= 5)
    candidates.push({
      id: "movies-5",
      prompt: {
        ru: "Вместе посмотрено пять фильмов",
        en: "You watched five movies together",
      },
    });
  if (Number(totals?.memories ?? 0) >= 10)
    candidates.push({
      id: "memories-10",
      prompt: {
        ru: "В вашей истории уже десять капсул",
        en: "Your history now holds ten capsules",
      },
    });
  if (completedActivity.type === "blitz" && (await blitzHasMatch(client, completedActivity.id)))
    candidates.push({
      id: "same-brain-first",
      prompt: {
        ru: "Первая находка «Одинаково думаем»",
        en: "Your first Same Brain match",
      },
    });
  if (completedActivity.type === "color-hunt")
    candidates.push({
      id: "color-hunt-first",
      prompt: {
        ru: "Вы завершили первую охоту за цветом",
        en: "You completed your first Color Hunt",
      },
    });

  const events: StoredEvent[] = [];
  for (const candidate of candidates) {
    const activityId = deterministicId("cooperative-milestone", `${conversationId}:${candidate.id}`);
    const inserted = await client.query(
      `INSERT INTO cooperative_activities(id,conversation_id,created_by,client_id,type,state,config,completed_at)
       VALUES ($1,$2,$3,$4,'milestone','completed',$5,now()) ON CONFLICT(id) DO NOTHING RETURNING id`,
      [activityId, conversationId, actorId, deterministicId("cooperative-milestone-client", `${conversationId}:${candidate.id}`), { milestoneId: candidate.id, prompt: candidate.prompt }],
    );
    if (!inserted.rowCount) continue;
    for (const recipientId of recipients) await client.query("INSERT INTO cooperative_activity_participants(activity_id,user_id,status,submitted_at) VALUES ($1,$2,'completed',now())", [activityId, recipientId]);
    const sequence = Number((await client.query<{ sequence: string }>("UPDATE conversations SET next_message_sequence=next_message_sequence+1,updated_at=now() WHERE id=$1 RETURNING (next_message_sequence-1)::text sequence", [conversationId])).rows[0]?.sequence ?? 0);
    const messageId = newId();
    await client.query(
      `INSERT INTO messages(id,stream_kind,stream_id,sequence,sender_id,client_id,kind,text,silent)
       VALUES ($1,'conversation',$2,$3,$4,$5,'system',$6,false)`,
      [messageId, conversationId, sequence, actorId, deterministicId("cooperative-milestone-message", `${conversationId}:${candidate.id}`), `✦ ${candidate.prompt.ru}`],
    );
    await client.query("UPDATE cooperative_activities SET anchor_message_id=$2,updated_at=now() WHERE id=$1", [activityId, messageId]);
    await client.query("INSERT INTO cooperative_activity_events(id,activity_id,actor_id,action,revision,metadata) VALUES ($1,$2,NULL,'created',0,$3)", [newId(), activityId, { milestoneId: candidate.id }]);
    const messages = await personalizedActivityMessages(client, messageId, recipients);
    events.push(await storeEvent(client, recipients, "message:created", (recipientId) => messages.get(recipientId)!));
  }
  return events;
}

export async function createMilestoneEventsForActivity(client: DbClient, activityId: string, actorId: string, recipients: string[]) {
  const row = (await client.query<ActivityRow>(activityRowSql("WHERE ca.id=$1"), [activityId])).rows[0];
  return row ? maybeCreateMilestoneEvents(client, row, actorId, recipients) : [];
}

async function blitzHasMatch(client: DbClient, activityId: string) {
  const entries = await client.query<{ payload: Record<string, unknown> }>("SELECT payload FROM cooperative_activity_entries WHERE activity_id=$1 AND kind='blitz' ORDER BY created_at,id", [activityId]);
  if (entries.rows.length < 2) return false;
  const first = Array.isArray(entries.rows[0]?.payload.answers) ? entries.rows[0]!.payload.answers : [];
  const second = Array.isArray(entries.rows[1]?.payload.answers) ? entries.rows[1]!.payload.answers : [];
  return first.some((answer, index) => answer === second[index]);
}

async function anchorMessage(client: DbClient, row: ActivityRow, viewerId: string) {
  if (!row.anchor_message_id) throw conflict("Activity has no chat message");
  return getMessageById(client, row.anchor_message_id, viewerId);
}

function activityRowSql(suffix: string) {
  return `SELECT ca.id,ca.conversation_id,ca.anchor_message_id,ca.created_by,ca.type,ca.state,ca.revision::text,ca.config,ca.result FROM cooperative_activities ca ${suffix}`;
}

function fallbackText(type: CooperativeActivityType) {
  const labels: Record<CooperativeActivityType, string> = {
    question: "✦ Вопрос для двоих",
    blitz: "✦ Блиц на 60 секунд",
    "tiny-quest": "✦ Маленький квест",
    "color-hunt": "✦ Охота за цветом",
    "song-exchange": "✦ Обмен песнями",
    "movie-list": "✦ Наш список фильмов",
    "draw-guess": "✦ Нарисуй и угадай",
    "ideas-jar": "✦ Банка идей",
    "memory-capsule": "✦ Капсула воспоминаний",
    milestone: "✦ Общее достижение",
  };
  return labels[type];
}

function safeEventMetadata(payload: Record<string, unknown>) {
  return Object.fromEntries(
    Object.keys(payload)
      .slice(0, 12)
      .map((key) => [key, "present"]),
  );
}
