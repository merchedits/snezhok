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
import { combinedRating, memoryRevealDate, normalizeGuess, parseDrawingStrokes, validSongUrl } from "./rules.js";
import { getActivityView } from "./view.js";

export interface ActivityCreateInput { clientId: string; type: CooperativeActivityType; options: Record<string, unknown>; }
export interface ActivityCommandInput {
  clientId: string;
  expectedRevision: number;
  action: "submit" | "add-item" | "update-item" | "remove-item" | "rate" | "set-status" | "pick" | "reroll" | "confirm" | "submit-drawing" | "guess" | "complete" | "decline" | "cancel";
  payload: Record<string, unknown>;
}

interface ActivityRow {
  id: string; conversation_id: string; anchor_message_id: string | null; created_by: string; type: CooperativeActivityType;
  state: CooperativeActivity["state"]; revision: string; config: Record<string, unknown>; result: Record<string, unknown> | null;
}

interface EntryRow { id: string; created_by: string; kind: string; payload: Record<string, unknown>; }
interface ActionResult { state?: CooperativeActivity["state"]; result?: Record<string, unknown>; revealAt?: Date; completed?: boolean; }

export async function createActivity(userId: string, conversationId: string, input: ActivityCreateInput) {
  if (input.type === "milestone") throw forbidden("Milestones are created automatically");
  const outcome = await transaction(async (client) => {
    const access = await resolveStreamAccess(userId, conversationId, client);
    if (access.streamKind !== "conversation") throw forbidden("Activities are available in private chats only");
    await assertDirectConversationMessagingAllowed(userId, conversationId, client);
    const conversation = (await client.query<{ kind: "direct" | "group"; participant_ids: string[] }>(
      `SELECT c.kind,array_agg(cm.user_id ORDER BY cm.joined_at,cm.user_id) participant_ids
       FROM conversations c JOIN conversation_members cm ON cm.conversation_id=c.id JOIN users u ON u.id=cm.user_id
       WHERE c.id=$1 AND u.deleted_at IS NULL GROUP BY c.id,c.kind`,
      [conversationId],
    )).rows[0];
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
      return { message: await getMessageById(client, duplicate.anchor_message_id, userId), event: null };
    }
    if (input.type === "movie-list" || input.type === "ideas-jar") {
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`activity-living:${conversationId}:${input.type}`]);
      const living = (await client.query<{ anchor_message_id: string }>(
        "SELECT anchor_message_id FROM cooperative_activities WHERE conversation_id=$1 AND type=$2 AND state NOT IN ('cancelled','declined','expired') AND anchor_message_id IS NOT NULL ORDER BY created_at LIMIT 1",
        [conversationId, input.type],
      )).rows[0];
      if (living) return { message: await getMessageById(client, living.anchor_message_id, userId), event: null };
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
      await client.query(
        "INSERT INTO cooperative_activity_participants(activity_id,user_id,private_state) VALUES ($1,$2,$3)",
        [activityId, participantId, privateState],
      );
    }

    const messageId = newId();
    const sequence = await allocateMessageSequence(access, client);
    await client.query(
      `INSERT INTO messages(id,stream_kind,stream_id,sequence,sender_id,client_id,kind,text,silent)
       VALUES ($1,'conversation',$2,$3,$4,$5,'system',$6,false)`,
      [messageId, conversationId, sequence, userId, newId(), fallbackText(input.type)],
    );
    await client.query("UPDATE cooperative_activities SET anchor_message_id=$2,updated_at=now() WHERE id=$1", [activityId, messageId]);
    await client.query(
      "INSERT INTO cooperative_activity_events(id,activity_id,actor_id,action,revision) VALUES ($1,$2,$3,'created',0)",
      [newId(), activityId, userId],
    );
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
      return { message: await anchorMessage(client, row, userId), events: [] as StoredEvent[] };
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
    await client.query(
      `INSERT INTO cooperative_activity_commands(activity_id,user_id,client_id,action,resulting_revision) VALUES ($1,$2,$3,$4,$5)`,
      [activityId, userId, input.clientId, input.action, nextRevision],
    );
    await client.query(
      `INSERT INTO cooperative_activity_events(id,activity_id,actor_id,action,revision,metadata) VALUES ($1,$2,$3,$4,$5,$6)`,
      [newId(), activityId, userId, input.action, nextRevision, safeEventMetadata(input.payload)],
    );
    const recipients = await streamRecipients(access, client);
    const messageId = row.anchor_message_id;
    if (!messageId) throw conflict("Activity has no chat message");
    const messages = await personalizedActivityMessages(client, messageId, recipients);
    const event = await storeEvent(client, recipients, "message:updated", (recipientId) => messages.get(recipientId)!);
    const milestoneEvents = result.completed === true || result.state === "completed" || result.state === "locked" || row.type === "movie-list"
      ? await maybeCreateMilestoneEvents(client, row, userId, recipients)
      : [];
    return { message: messages.get(userId)!, events: [event, ...milestoneEvents] };
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
    return getMessagesByIds(client, anchors.rows.map((anchor) => anchor.anchor_message_id), userId);
  });
}

async function applyAction(client: DbClient, activity: ActivityRow, userId: string, action: ActivityCommandInput["action"], payload: Record<string, unknown>): Promise<ActionResult> {
  switch (activity.type) {
    case "question": return submitPair(client, activity, userId, action, "answer", { answer: requiredString(payload.answer, 1, 4_000) });
    case "blitz": {
      if (action !== "submit") throw conflict("This action is not available for Blitz");
      const promptCount = Array.isArray(activity.config.prompts) ? activity.config.prompts.length : 0;
      const answers = Array.isArray(payload.answers) ? payload.answers : [];
      if (answers.length !== promptCount || answers.some((answer) => answer !== "left" && answer !== "right")) throw conflict("Answer every Blitz prompt");
      return submitPair(client, activity, userId, action, "blitz", { answers });
    }
    case "tiny-quest": {
      if (action !== "submit") throw conflict("This action is not available for Tiny Quest");
      const attachmentIds = attachmentIdsFrom(payload, 1, 1);
      await requireImageAttachments(client, userId, attachmentIds);
      return submitPair(client, activity, userId, action, "submission", { caption: optionalString(payload.caption, 500) }, attachmentIds);
    }
    case "song-exchange": {
      if (action !== "submit") throw conflict("This action is not available for Song Exchange");
      const url = requiredString(payload.url, 8, 2_048);
      if (!validSongUrl(url)) throw conflict("Enter a valid HTTPS song link");
      return submitPair(client, activity, userId, action, "song", {
        url, title: requiredString(payload.title, 1, 200), artist: optionalString(payload.artist, 200), artworkUrl: optionalString(payload.artworkUrl, 2_048),
      });
    }
    case "color-hunt": return mutateColorHunt(client, activity, userId, action, payload);
    case "movie-list": return mutateMovieList(client, activity, userId, action, payload);
    case "ideas-jar": return mutateIdeasJar(client, activity, userId, action, payload);
    case "draw-guess": return mutateDrawGuess(client, activity, userId, action, payload);
    case "memory-capsule": return mutateMemoryCapsule(client, activity, userId, action, payload);
    case "milestone": throw forbidden("Milestones cannot be edited");
  }
}

async function submitPair(client: DbClient, activity: ActivityRow, userId: string, action: string, kind: string, payload: Record<string, unknown>, attachmentIds: string[] = []) {
  if (action !== "submit") throw conflict("This activity expects a submission");
  await requireFreshSubmission(client, activity.id, userId);
  await replacePersonalEntry(client, activity.id, userId, kind, payload, attachmentIds);
  await markSubmitted(client, activity.id, userId);
  const complete = await allParticipantsSubmitted(client, activity.id);
  return { state: complete ? "completed" as const : "waiting" as const, completed: complete };
}

async function mutateColorHunt(client: DbClient, activity: ActivityRow, userId: string, action: string, payload: Record<string, unknown>): Promise<ActionResult> {
  if (action !== "add-item" && action !== "submit") throw conflict("Add a photo to the Color Hunt");
  const target = typeof activity.config.target === "number" ? activity.config.target : 9;
  const count = Number((await client.query<{ count: string }>("SELECT count(*)::text count FROM cooperative_activity_entries WHERE activity_id=$1 AND created_by=$2 AND kind='photo'", [activity.id, userId])).rows[0]?.count ?? 0);
  if (count >= target) throw conflict("Your color board is already full");
  const attachmentIds = attachmentIdsFrom(payload, 1, 1);
  await requireImageAttachments(client, userId, attachmentIds);
  await insertEntry(client, activity.id, userId, "photo", {}, attachmentIds, count);
  const newCount = count + 1;
  if (newCount >= target) {
    await markSubmitted(client, activity.id, userId);
    await enqueueColorCollage(client, activity.id, userId, target);
  }
  const complete = newCount >= target && await allParticipantsSubmitted(client, activity.id);
  return { state: complete ? "completed" : "active", completed: complete, ...(complete ? { result: { target, collage: "media-worker" } } : {}) };
}

async function requireImageAttachments(client: DbClient, userId: string, attachmentIds: string[]) {
  const images = await client.query("SELECT 1 FROM attachments WHERE id=ANY($1::uuid[]) AND owner_id=$2 AND kind='image' AND status IN ('ready','processing')", [attachmentIds, userId]);
  if (images.rowCount !== attachmentIds.length) throw conflict("This activity accepts photos only");
}

async function enqueueColorCollage(client: DbClient, activityId: string, userId: string, target: number) {
  if (target !== 9) throw conflict("Color collage requires nine photos");
  const existing = await client.query("SELECT 1 FROM cooperative_activity_entries WHERE activity_id=$1 AND created_by=$2 AND kind='collage'", [activityId, userId]);
  if (existing.rowCount) return;
  const sources = (await client.query<{ attachment_id: string }>(
    `SELECT link.attachment_id FROM cooperative_activity_entries entry
       JOIN cooperative_activity_attachments link ON link.entry_id=entry.id
      WHERE entry.activity_id=$1 AND entry.created_by=$2 AND entry.kind='photo'
      ORDER BY entry.round,entry.created_at,entry.id,link.position LIMIT 9`,
    [activityId, userId],
  )).rows.map((row) => row.attachment_id);
  if (sources.length !== 9) throw conflict("Color collage is missing source photos");
  const attachmentId = newId();
  const entryId = newId();
  await client.query(
    `INSERT INTO attachments(id,owner_id,blob_id,filename,kind,mime_type,bytes,width,height,quality,status)
     VALUES ($1,$2,NULL,$3,'image','image/webp',0,1080,1080,'high','processing')`,
    [attachmentId, userId, `snezhok-color-hunt-${activityId}.webp`],
  );
  await client.query(
    "INSERT INTO cooperative_activity_entries(id,activity_id,created_by,kind,payload) VALUES ($1,$2,$3,'collage',$4)",
    [entryId, activityId, userId, { sourceCount: 9 }],
  );
  await client.query("INSERT INTO cooperative_activity_attachments(entry_id,attachment_id,position) VALUES ($1,$2,0)", [entryId, attachmentId]);
  await client.query(
    "INSERT INTO media_jobs(id,attachment_id,profile,operation,source_attachment_ids) VALUES ($1,$2,'high','color-collage',$3)",
    [newId(), attachmentId, sources],
  );
}

async function mutateMovieList(client: DbClient, activity: ActivityRow, userId: string, action: string, payload: Record<string, unknown>): Promise<ActionResult> {
  if (action === "add-item") {
    await insertEntry(client, activity.id, userId, "movie", {
      title: requiredString(payload.title, 1, 200), year: optionalInteger(payload.year, 1888, 2200), status: payload.status === "watched" ? "watched" : "want", ratings: {}, combinedRating: null,
    });
    return { state: "active" };
  }
  if (action === "pick" || action === "reroll") {
    const candidates = await client.query<{ id: string }>("SELECT id FROM cooperative_activity_entries WHERE activity_id=$1 AND kind='movie' AND payload->>'status'='want' ORDER BY created_at,id", [activity.id]);
    if (!candidates.rows.length) throw conflict("Add a movie to the watch list first");
    const previous = typeof activity.result?.selectedEntryId === "string" ? activity.result.selectedEntryId : null;
    const available = candidates.rows.filter((item) => candidates.rows.length === 1 || item.id !== previous);
    return { state: "active", result: { selectedEntryId: available[randomInt(available.length)]!.id, pickedAt: Date.now() } };
  }
  const entry = await lockEntry(client, activity.id, requiredId(payload.entryId), "movie");
  if (!participantMayEditEntry(entry.created_by, userId, action)) throw forbidden("Only the person who added this movie can change it");
  if (action === "remove-item") {
    await client.query("DELETE FROM cooperative_activity_entries WHERE id=$1", [entry.id]);
    return { state: "active", result: selectionAfterEntryChange(activity.result, entry.id, true) };
  }
  if (action === "rate") {
    const rating = requiredNumber(payload.rating, 1, 10);
    const ratings = objectValue(entry.payload.ratings);
    ratings[userId] = rating;
    await updateEntry(client, entry.id, { ...entry.payload, ratings, combinedRating: combinedRating(ratings) });
    return { state: "active" };
  }
  if (action === "set-status" || action === "confirm" || action === "complete") {
    const status = action === "complete" ? "watched" : payload.status === "watched" ? "watched" : "want";
    await updateEntry(client, entry.id, { ...entry.payload, status });
    return { state: "active", result: selectionAfterEntryChange(activity.result, entry.id, status === "watched") };
  }
  if (action === "update-item") {
    await updateEntry(client, entry.id, { ...entry.payload, title: requiredString(payload.title, 1, 200), year: optionalInteger(payload.year, 1888, 2200) });
    return { state: "active" };
  }
  throw conflict("This movie action is not available");
}

async function mutateIdeasJar(client: DbClient, activity: ActivityRow, userId: string, action: string, payload: Record<string, unknown>): Promise<ActionResult> {
  if (action === "add-item") {
    await insertEntry(client, activity.id, userId, "idea", { title: requiredString(payload.title, 1, 240), status: "planned" });
    return { state: "active" };
  }
  if (action === "pick" || action === "reroll") {
    const candidates = await client.query<{ id: string }>("SELECT id FROM cooperative_activity_entries WHERE activity_id=$1 AND kind='idea' AND payload->>'status'='planned' ORDER BY created_at,id", [activity.id]);
    if (!candidates.rows.length) throw conflict("Add an idea before picking one");
    const previous = typeof activity.result?.selectedEntryId === "string" ? activity.result.selectedEntryId : null;
    const available = candidates.rows.filter((item) => candidates.rows.length === 1 || item.id !== previous);
    return { state: "active", result: { selectedEntryId: available[randomInt(available.length)]!.id, pickedAt: Date.now() } };
  }
  const entry = await lockEntry(client, activity.id, requiredId(payload.entryId ?? activity.result?.selectedEntryId), "idea");
  if (!participantMayEditEntry(entry.created_by, userId, action)) throw forbidden("Only the person who added this idea can change it");
  if (action === "remove-item") {
    await client.query("DELETE FROM cooperative_activity_entries WHERE id=$1", [entry.id]);
    return { state: "active", result: selectionAfterEntryChange(activity.result, entry.id, true) };
  }
  if (action === "update-item") {
    await updateEntry(client, entry.id, { ...entry.payload, title: requiredString(payload.title, 1, 240) });
    return { state: "active" };
  }
  if (action === "confirm" || action === "complete" || action === "set-status") {
    const status = action === "complete" || action === "confirm" ? "done" : payload.status === "done" ? "done" : "planned";
    await updateEntry(client, entry.id, { ...entry.payload, status, completedAt: status === "done" ? Date.now() : null });
    return { state: "active", result: selectionAfterEntryChange(activity.result, entry.id, status === "done") };
  }
  throw conflict("This ideas-jar action is not available");
}

async function mutateDrawGuess(client: DbClient, activity: ActivityRow, userId: string, action: string, payload: Record<string, unknown>): Promise<ActionResult> {
  const drawerId = typeof activity.config.drawerId === "string" ? activity.config.drawerId : "";
  if (action === "submit-drawing") {
    if (userId !== drawerId) throw forbidden("Only the drawer can submit the drawing");
    await requireFreshSubmission(client, activity.id, userId);
    const width = requiredNumber(payload.width, 100, 4_000);
    const height = requiredNumber(payload.height, 100, 4_000);
    const strokes = parseDrawingStrokes(payload.strokes, width, height);
    if (!strokes) throw conflict("Drawing data is malformed or too large");
    await replacePersonalEntry(client, activity.id, userId, "drawing", { strokes, width, height });
    await markSubmitted(client, activity.id, userId);
    return { state: "waiting" };
  }
  if (action !== "guess") throw conflict("This Draw & Guess action is not available");
  if (userId === drawerId) throw forbidden("The drawer cannot guess the word");
  const drawing = await client.query("SELECT 1 FROM cooperative_activity_entries WHERE activity_id=$1 AND kind='drawing'", [activity.id]);
  if (!drawing.rowCount) throw conflict("Wait for the drawing");
  const attemptCount = Number((await client.query<{ count: string }>("SELECT count(*)::text count FROM cooperative_activity_entries WHERE activity_id=$1 AND kind='guess'", [activity.id])).rows[0]?.count ?? 0);
  if (attemptCount >= 100) throw conflict("This drawing has reached its guess limit");
  const guess = requiredString(payload.guess, 1, 100);
  const drawer = (await client.query<{ private_state: Record<string, unknown> }>("SELECT private_state FROM cooperative_activity_participants WHERE activity_id=$1 AND user_id=$2", [activity.id, drawerId])).rows[0];
  const word = objectValue(drawer?.private_state.word);
  const correct = [word.ru, word.en].some((candidate) => typeof candidate === "string" && normalizeGuess(candidate) === normalizeGuess(guess));
  await insertEntry(client, activity.id, userId, "guess", { guess, correct });
  if (correct) await client.query("UPDATE cooperative_activity_participants SET status='completed',submitted_at=now(),updated_at=now() WHERE activity_id=$1", [activity.id]);
  return { state: correct ? "completed" : "waiting", completed: correct, ...(correct ? { result: { guessedBy: userId, word } } : {}) };
}

async function mutateMemoryCapsule(client: DbClient, activity: ActivityRow, userId: string, action: string, payload: Record<string, unknown>): Promise<ActionResult> {
  if (action !== "submit") throw conflict("Add your memory to the capsule");
  if (activity.state === "locked") throw conflict("This capsule is locked");
  const text = optionalString(payload.text, 4_000);
  const songUrl = optionalString(payload.songUrl, 2_048);
  if (songUrl && !validSongUrl(songUrl)) throw conflict("Enter a valid HTTPS song link");
  const attachmentIds = attachmentIdsFrom(payload, 0, 4);
  if (!text && !songUrl && !attachmentIds.length) throw conflict("Add a message, photo, or song");
  await requireFreshSubmission(client, activity.id, userId);
  if (attachmentIds.length) await requireImageAttachments(client, userId, attachmentIds);
  await replacePersonalEntry(client, activity.id, userId, "memory", { text, songUrl }, attachmentIds);
  await markSubmitted(client, activity.id, userId);
  if (!(await allParticipantsSubmitted(client, activity.id))) return { state: "waiting" };
  const months = typeof activity.config.months === "number" ? activity.config.months : 1;
  return { state: "locked", revealAt: memoryRevealDate(new Date(), months) };
}

async function replacePersonalEntry(client: DbClient, activityId: string, userId: string, kind: string, payload: Record<string, unknown>, attachmentIds: string[] = []) {
  const existing = (await client.query<{ id: string }>("SELECT id FROM cooperative_activity_entries WHERE activity_id=$1 AND created_by=$2 AND kind=$3 ORDER BY created_at LIMIT 1 FOR UPDATE", [activityId, userId, kind])).rows[0];
  if (!existing) return insertEntry(client, activityId, userId, kind, payload, attachmentIds);
  await client.query("DELETE FROM cooperative_activity_attachments WHERE entry_id=$1", [existing.id]);
  await updateEntry(client, existing.id, payload);
  await linkAttachments(client, existing.id, userId, attachmentIds);
  return existing.id;
}

async function insertEntry(client: DbClient, activityId: string, userId: string, kind: string, payload: Record<string, unknown>, attachmentIds: string[] = [], round = 0) {
  const id = newId();
  await client.query("INSERT INTO cooperative_activity_entries(id,activity_id,created_by,kind,round,payload) VALUES ($1,$2,$3,$4,$5,$6)", [id, activityId, userId, kind, round, payload]);
  await linkAttachments(client, id, userId, attachmentIds);
  return id;
}

async function linkAttachments(client: DbClient, entryId: string, userId: string, attachmentIds: string[]) {
  if (!attachmentIds.length) return;
  const available = await client.query<{ id: string }>("SELECT id FROM attachments WHERE id=ANY($1::uuid[]) AND owner_id=$2 AND status IN ('ready','processing')", [attachmentIds, userId]);
  if (available.rowCount !== attachmentIds.length) throw forbidden("One or more attachments are unavailable");
  for (const [position, id] of attachmentIds.entries()) await client.query("INSERT INTO cooperative_activity_attachments(entry_id,attachment_id,position) VALUES ($1,$2,$3)", [entryId, id, position]);
}

async function lockEntry(client: DbClient, activityId: string, entryId: string, kind: string) {
  const entry = (await client.query<EntryRow>("SELECT id,created_by,kind,payload FROM cooperative_activity_entries WHERE id=$1 AND activity_id=$2 AND kind=$3 FOR UPDATE", [entryId, activityId, kind])).rows[0];
  if (!entry) throw notFound("Activity item not found");
  return entry;
}

async function updateEntry(client: DbClient, id: string, payload: Record<string, unknown>) {
  await client.query("UPDATE cooperative_activity_entries SET payload=$2,updated_at=now() WHERE id=$1", [id, payload]);
}

async function markSubmitted(client: DbClient, activityId: string, userId: string) {
  await client.query("UPDATE cooperative_activity_participants SET status='submitted',submitted_at=now(),updated_at=now() WHERE activity_id=$1 AND user_id=$2", [activityId, userId]);
}

async function requireFreshSubmission(client: DbClient, activityId: string, userId: string) {
  const participant = (await client.query<{ status: ActivityParticipantStatus }>(
    "SELECT status FROM cooperative_activity_participants WHERE activity_id=$1 AND user_id=$2 FOR UPDATE",
    [activityId, userId],
  )).rows[0];
  if (!participant || !participantMaySubmit(participant.status)) throw conflict("Your contribution is already final");
}

async function allParticipantsSubmitted(client: DbClient, activityId: string) {
  const row = (await client.query<{ complete: boolean }>("SELECT bool_and(status IN ('submitted','completed')) complete FROM cooperative_activity_participants WHERE activity_id=$1", [activityId])).rows[0];
  return row?.complete === true;
}

export async function personalizedActivityMessages(client: DbClient, messageId: string, recipients: string[]) {
  const entries = await Promise.all(recipients.map(async (recipientId) => [recipientId, await getMessageById(client, messageId, recipientId)] as const));
  return new Map<string, Message>(entries);
}

async function maybeCreateMilestoneEvents(client: DbClient, completedActivity: ActivityRow, actorId: string, recipients: string[]) {
  const conversationId = completedActivity.conversation_id;
  const totals = (await client.query<{ completed: string; questions: string; memories: string; watched: string }>(
    `SELECT
      count(*) FILTER (WHERE ca.state='completed' AND ca.type<>'milestone')::text completed,
      count(*) FILTER (WHERE ca.state='completed' AND ca.type='question')::text questions,
      count(*) FILTER (WHERE ca.state IN ('locked','completed') AND ca.type='memory-capsule')::text memories,
      (SELECT count(*)::text FROM cooperative_activity_entries entry JOIN cooperative_activities list ON list.id=entry.activity_id
       WHERE list.conversation_id=$1 AND entry.kind='movie' AND entry.payload->>'status'='watched') watched
     FROM cooperative_activities ca WHERE ca.conversation_id=$1`,
    [conversationId],
  )).rows[0];
  const candidates: Array<{ id: string; prompt: { ru: string; en: string } }> = [];
  if (Number(totals?.completed ?? 0) >= 1) candidates.push({ id: "first-activity", prompt: { ru: "Вы сделали первую вещь вместе", en: "You made your first thing together" } });
  if (Number(totals?.questions ?? 0) >= 25) candidates.push({ id: "questions-25", prompt: { ru: "25 вопросов получили два ответа", en: "You answered 25 questions together" } });
  if (Number(totals?.watched ?? 0) >= 5) candidates.push({ id: "movies-5", prompt: { ru: "Вместе посмотрено пять фильмов", en: "You watched five movies together" } });
  if (Number(totals?.memories ?? 0) >= 10) candidates.push({ id: "memories-10", prompt: { ru: "В вашей истории уже десять капсул", en: "Your history now holds ten capsules" } });
  if (completedActivity.type === "blitz" && await blitzHasMatch(client, completedActivity.id)) candidates.push({ id: "same-brain-first", prompt: { ru: "Первая находка «Одинаково думаем»", en: "Your first Same Brain match" } });
  if (completedActivity.type === "color-hunt") candidates.push({ id: "color-hunt-first", prompt: { ru: "Вы завершили первую охоту за цветом", en: "You completed your first Color Hunt" } });

  const events: StoredEvent[] = [];
  for (const candidate of candidates) {
    const activityId = deterministicId("cooperative-milestone", `${conversationId}:${candidate.id}`);
    const inserted = await client.query(
      `INSERT INTO cooperative_activities(id,conversation_id,created_by,client_id,type,state,config,completed_at)
       VALUES ($1,$2,$3,$4,'milestone','completed',$5,now()) ON CONFLICT(id) DO NOTHING RETURNING id`,
      [activityId, conversationId, actorId, deterministicId("cooperative-milestone-client", `${conversationId}:${candidate.id}`), { milestoneId: candidate.id, prompt: candidate.prompt }],
    );
    if (!inserted.rowCount) continue;
    for (const recipientId of recipients) await client.query(
      "INSERT INTO cooperative_activity_participants(activity_id,user_id,status,submitted_at) VALUES ($1,$2,'completed',now())",
      [activityId, recipientId],
    );
    const sequence = Number((await client.query<{ sequence: string }>(
      "UPDATE conversations SET next_message_sequence=next_message_sequence+1,updated_at=now() WHERE id=$1 RETURNING (next_message_sequence-1)::text sequence",
      [conversationId],
    )).rows[0]?.sequence ?? 0);
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
    question: "✦ Вопрос для двоих", blitz: "✦ Блиц на 60 секунд", "tiny-quest": "✦ Маленький квест", "color-hunt": "✦ Охота за цветом",
    "song-exchange": "✦ Обмен песнями", "movie-list": "✦ Наш список фильмов", "draw-guess": "✦ Нарисуй и угадай", "ideas-jar": "✦ Банка идей",
    "memory-capsule": "✦ Капсула воспоминаний", milestone: "✦ Общее достижение",
  };
  return labels[type];
}

function safeEventMetadata(payload: Record<string, unknown>) {
  return Object.fromEntries(Object.keys(payload).slice(0, 12).map((key) => [key, "present"]));
}

function requiredString(value: unknown, min: number, max: number) {
  if (typeof value !== "string") throw conflict("A required value is missing");
  const result = value.trim();
  if (result.length < min || result.length > max) throw conflict("A value has an invalid length");
  return result;
}

function optionalString(value: unknown, max: number) {
  if (value === undefined || value === null || value === "") return "";
  return requiredString(value, 1, max);
}

function requiredNumber(value: unknown, min: number, max: number) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) throw conflict("A numeric value is outside the allowed range");
  return value;
}

function optionalInteger(value: unknown, min: number, max: number) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) throw conflict("A year is outside the allowed range");
  return value;
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? { ...value as Record<string, unknown> } : {};
}

function requiredId(value: unknown) {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw conflict("A valid item ID is required");
  return value;
}

function attachmentIdsFrom(payload: Record<string, unknown>, min: number, max: number) {
  const ids = Array.isArray(payload.attachmentIds) ? payload.attachmentIds : [];
  if (ids.length < min || ids.length > max || ids.some((id) => typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id)) || new Set(ids).size !== ids.length) throw conflict("Select the required number of valid attachments");
  return ids as string[];
}
