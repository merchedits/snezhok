import { randomInt } from "node:crypto";
import type { DbClient } from "../../db/pool.js";
import { isGameKind } from "@snezhok/game-engine";
import { conflict, forbidden, notFound } from "../../lib/errors.js";
import { newId } from "../../lib/ids.js";
import { participantMayEditEntry, participantMaySubmit, selectionAfterEntryChange, type ActivityParticipantStatus } from "./policy.js";
import { colorHuntBatchLimit, combinedRating, memoryRevealDate, normalizeGuess, parseDrawingStrokes, validSongUrl } from "./rules.js";
import type { ActionResult, ActivityCommandInput, ActivityRow, EntryRow } from "./activityModel.js";
import { attachmentIdsFrom, objectValue, optionalInteger, optionalString, requiredId, requiredNumber, requiredString } from "./activityValidation.js";
import { mutateGame } from "./games/gameActions.js";

export async function applyAction(client: DbClient, activity: ActivityRow, userId: string, action: ActivityCommandInput["action"], payload: Record<string, unknown>): Promise<ActionResult> {
  if (isGameKind(activity.type)) return mutateGame(client, activity, userId, action, payload);
  switch (activity.type) {
    case "question":
      return submitPair(client, activity, userId, action, "answer", {
        answer: requiredString(payload.answer, 1, 4_000),
      });
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
        url,
        title: requiredString(payload.title, 1, 200),
        artist: optionalString(payload.artist, 200),
        artworkUrl: optionalString(payload.artworkUrl, 2_048),
      });
    }
    case "color-hunt":
      return mutateColorHunt(client, activity, userId, action, payload);
    case "movie-list":
      return mutateMovieList(client, activity, userId, action, payload);
    case "ideas-jar":
      return mutateIdeasJar(client, activity, userId, action, payload);
    case "draw-guess":
      return mutateDrawGuess(client, activity, userId, action, payload);
    case "memory-capsule":
      return mutateMemoryCapsule(client, activity, userId, action, payload);
    case "milestone":
      throw forbidden("Milestones cannot be edited");
  }
}

async function submitPair(client: DbClient, activity: ActivityRow, userId: string, action: string, kind: string, payload: Record<string, unknown>, attachmentIds: string[] = []) {
  if (action !== "submit") throw conflict("This activity expects a submission");
  await requireFreshSubmission(client, activity.id, userId);
  await replacePersonalEntry(client, activity.id, userId, kind, payload, attachmentIds);
  await markSubmitted(client, activity.id, userId);
  const complete = await allParticipantsSubmitted(client, activity.id);
  return {
    state: complete ? ("completed" as const) : ("waiting" as const),
    completed: complete,
  };
}

async function mutateColorHunt(client: DbClient, activity: ActivityRow, userId: string, action: string, payload: Record<string, unknown>): Promise<ActionResult> {
  if (action !== "add-item" && action !== "submit") throw conflict("Add a photo to the Color Hunt");
  const target = typeof activity.config.target === "number" ? activity.config.target : 9;
  const count = Number((await client.query<{ count: string }>("SELECT count(*)::text count FROM cooperative_activity_entries WHERE activity_id=$1 AND created_by=$2 AND kind='photo'", [activity.id, userId])).rows[0]?.count ?? 0);
  if (count >= target) throw conflict("Your color board is already full");
  const attachmentIds = attachmentIdsFrom(payload, 1, colorHuntBatchLimit(target, count));
  await requireImageAttachments(client, userId, attachmentIds);
  for (const [index, attachmentId] of attachmentIds.entries()) {
    await insertEntry(client, activity.id, userId, "photo", {}, [attachmentId], count + index);
  }
  const newCount = count + attachmentIds.length;
  if (newCount >= target) {
    await markSubmitted(client, activity.id, userId);
    await enqueueColorCollage(client, activity.id, userId, target);
  }
  const complete = newCount >= target && (await allParticipantsSubmitted(client, activity.id));
  return {
    state: complete ? "completed" : "active",
    completed: complete,
    ...(complete ? { result: { target, collage: "media-worker" } } : {}),
  };
}

async function requireImageAttachments(client: DbClient, userId: string, attachmentIds: string[]) {
  const images = await client.query("SELECT 1 FROM attachments WHERE id=ANY($1::uuid[]) AND owner_id=$2 AND kind='image' AND status IN ('ready','processing')", [attachmentIds, userId]);
  if (images.rowCount !== attachmentIds.length) throw conflict("This activity accepts photos only");
}

async function enqueueColorCollage(client: DbClient, activityId: string, userId: string, target: number) {
  if (target !== 9) throw conflict("Color collage requires nine photos");
  const existing = await client.query("SELECT 1 FROM cooperative_activity_entries WHERE activity_id=$1 AND created_by=$2 AND kind='collage'", [activityId, userId]);
  if (existing.rowCount) return;
  const sources = (
    await client.query<{ attachment_id: string }>(
      `SELECT link.attachment_id FROM cooperative_activity_entries entry
       JOIN cooperative_activity_attachments link ON link.entry_id=entry.id
      WHERE entry.activity_id=$1 AND entry.created_by=$2 AND entry.kind='photo'
      ORDER BY entry.round,entry.created_at,entry.id,link.position LIMIT 9`,
      [activityId, userId],
    )
  ).rows.map((row) => row.attachment_id);
  if (sources.length !== 9) throw conflict("Color collage is missing source photos");
  const attachmentId = newId();
  const entryId = newId();
  await client.query(
    `INSERT INTO attachments(id,owner_id,blob_id,filename,kind,mime_type,bytes,width,height,quality,status)
     VALUES ($1,$2,NULL,$3,'image','image/png',0,2160,2160,'high','processing')`,
    [attachmentId, userId, `snezhok-color-hunt-${activityId}.png`],
  );
  await client.query("INSERT INTO cooperative_activity_entries(id,activity_id,created_by,kind,payload) VALUES ($1,$2,$3,'collage',$4)", [entryId, activityId, userId, { sourceCount: 9 }]);
  await client.query("INSERT INTO cooperative_activity_attachments(entry_id,attachment_id,position) VALUES ($1,$2,0)", [entryId, attachmentId]);
  await client.query("INSERT INTO media_jobs(id,attachment_id,profile,operation,source_attachment_ids) VALUES ($1,$2,'high','color-collage',$3)", [newId(), attachmentId, sources]);
}

async function mutateMovieList(client: DbClient, activity: ActivityRow, userId: string, action: string, payload: Record<string, unknown>): Promise<ActionResult> {
  if (action === "add-item") {
    await insertEntry(client, activity.id, userId, "movie", {
      title: requiredString(payload.title, 1, 200),
      year: optionalInteger(payload.year, 1888, 2200),
      status: payload.status === "watched" ? "watched" : "want",
      ratings: {},
      combinedRating: null,
    });
    return { state: "active" };
  }
  if (action === "pick" || action === "reroll") {
    const candidates = await client.query<{ id: string }>("SELECT id FROM cooperative_activity_entries WHERE activity_id=$1 AND kind='movie' AND payload->>'status'='want' ORDER BY created_at,id", [activity.id]);
    if (!candidates.rows.length) throw conflict("Add a movie to the watch list first");
    const previous = typeof activity.result?.selectedEntryId === "string" ? activity.result.selectedEntryId : null;
    const available = candidates.rows.filter((item) => candidates.rows.length === 1 || item.id !== previous);
    return {
      state: "active",
      result: {
        selectedEntryId: available[randomInt(available.length)]!.id,
        pickedAt: Date.now(),
      },
    };
  }
  const entry = await lockEntry(client, activity.id, requiredId(payload.entryId), "movie");
  if (!participantMayEditEntry(entry.created_by, userId, action)) throw forbidden("Only the person who added this movie can change it");
  if (action === "remove-item") {
    await client.query("DELETE FROM cooperative_activity_entries WHERE id=$1", [entry.id]);
    return {
      state: "active",
      result: selectionAfterEntryChange(activity.result, entry.id, true),
    };
  }
  if (action === "rate") {
    const rating = requiredNumber(payload.rating, 1, 10);
    const ratings = objectValue(entry.payload.ratings);
    ratings[userId] = rating;
    await updateEntry(client, entry.id, {
      ...entry.payload,
      ratings,
      combinedRating: combinedRating(ratings),
    });
    return { state: "active" };
  }
  if (action === "set-status" || action === "confirm" || action === "complete") {
    const status = action === "complete" ? "watched" : payload.status === "watched" ? "watched" : "want";
    await updateEntry(client, entry.id, { ...entry.payload, status });
    return {
      state: "active",
      result: selectionAfterEntryChange(activity.result, entry.id, status === "watched"),
    };
  }
  if (action === "update-item") {
    await updateEntry(client, entry.id, {
      ...entry.payload,
      title: requiredString(payload.title, 1, 200),
      year: optionalInteger(payload.year, 1888, 2200),
    });
    return { state: "active" };
  }
  throw conflict("This movie action is not available");
}

async function mutateIdeasJar(client: DbClient, activity: ActivityRow, userId: string, action: string, payload: Record<string, unknown>): Promise<ActionResult> {
  if (action === "add-item") {
    await insertEntry(client, activity.id, userId, "idea", {
      title: requiredString(payload.title, 1, 240),
      status: "planned",
    });
    return { state: "active" };
  }
  if (action === "pick" || action === "reroll") {
    const candidates = await client.query<{ id: string }>("SELECT id FROM cooperative_activity_entries WHERE activity_id=$1 AND kind='idea' AND payload->>'status'='planned' ORDER BY created_at,id", [activity.id]);
    if (!candidates.rows.length) throw conflict("Add an idea before picking one");
    const previous = typeof activity.result?.selectedEntryId === "string" ? activity.result.selectedEntryId : null;
    const available = candidates.rows.filter((item) => candidates.rows.length === 1 || item.id !== previous);
    return {
      state: "active",
      result: {
        selectedEntryId: available[randomInt(available.length)]!.id,
        pickedAt: Date.now(),
      },
    };
  }
  const entry = await lockEntry(client, activity.id, requiredId(payload.entryId ?? activity.result?.selectedEntryId), "idea");
  if (!participantMayEditEntry(entry.created_by, userId, action)) throw forbidden("Only the person who added this idea can change it");
  if (action === "remove-item") {
    await client.query("DELETE FROM cooperative_activity_entries WHERE id=$1", [entry.id]);
    return {
      state: "active",
      result: selectionAfterEntryChange(activity.result, entry.id, true),
    };
  }
  if (action === "update-item") {
    await updateEntry(client, entry.id, {
      ...entry.payload,
      title: requiredString(payload.title, 1, 240),
    });
    return { state: "active" };
  }
  if (action === "confirm" || action === "complete" || action === "set-status") {
    const status = action === "complete" || action === "confirm" ? "done" : payload.status === "done" ? "done" : "planned";
    await updateEntry(client, entry.id, {
      ...entry.payload,
      status,
      completedAt: status === "done" ? Date.now() : null,
    });
    return {
      state: "active",
      result: selectionAfterEntryChange(activity.result, entry.id, status === "done"),
    };
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
    await replacePersonalEntry(client, activity.id, userId, "drawing", {
      strokes,
      width,
      height,
    });
    await markSubmitted(client, activity.id, userId);
    return { state: "waiting" };
  }
  if (action !== "guess") throw conflict("This Draw & Guess action is not available");
  if (userId === drawerId) throw forbidden("The drawer cannot guess the word");
  // Guesses are part of the live round: the drawer's realtime strokes are
  // deliberately visible before the final immutable drawing is submitted.
  const attemptCount = Number((await client.query<{ count: string }>("SELECT count(*)::text count FROM cooperative_activity_entries WHERE activity_id=$1 AND kind='guess'", [activity.id])).rows[0]?.count ?? 0);
  if (attemptCount >= 100) throw conflict("This drawing has reached its guess limit");
  const guess = requiredString(payload.guess, 1, 100);
  const drawer = (await client.query<{ private_state: Record<string, unknown> }>("SELECT private_state FROM cooperative_activity_participants WHERE activity_id=$1 AND user_id=$2", [activity.id, drawerId])).rows[0];
  const word = objectValue(drawer?.private_state.word);
  const correct = [word.ru, word.en].some((candidate) => typeof candidate === "string" && normalizeGuess(candidate) === normalizeGuess(guess));
  await insertEntry(client, activity.id, userId, "guess", { guess, correct });
  if (correct) await client.query("UPDATE cooperative_activity_participants SET status='completed',submitted_at=now(),updated_at=now() WHERE activity_id=$1", [activity.id]);
  return {
    state: correct ? "completed" : "waiting",
    completed: correct,
    ...(correct ? { result: { guessedBy: userId, word } } : {}),
  };
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
  const participant = (await client.query<{ status: ActivityParticipantStatus }>("SELECT status FROM cooperative_activity_participants WHERE activity_id=$1 AND user_id=$2 FOR UPDATE", [activityId, userId])).rows[0];
  if (!participant || !participantMaySubmit(participant.status)) throw conflict("Your contribution is already final");
}

async function allParticipantsSubmitted(client: DbClient, activityId: string) {
  const row = (await client.query<{ complete: boolean }>("SELECT bool_and(status IN ('submitted','completed')) complete FROM cooperative_activity_participants WHERE activity_id=$1", [activityId])).rows[0];
  return row?.complete === true;
}
