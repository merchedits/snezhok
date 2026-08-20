import type { CallEndReason } from "@snezhok/contracts";
import { config } from "../../config.js";
import { pool, transaction, type DbClient } from "../../db/pool.js";
import { incrementMetric } from "../../lib/metrics.js";
import { AppError } from "../../lib/errors.js";
import { publishStoredEvent, storeEvent, type StoredEvent } from "../realtime/events.js";
import { resolveStreamAccess, streamRecipients, type StreamAccess } from "../streams/access.js";
import { assertDirectConversationMessagingAllowed } from "../users/privacy.js";
import { voiceChannelGrantPolicy } from "./semantics.js";
import { getCallMediaPlane, type CallMediaPlane } from "./mediaPlane.js";

interface MaintenanceLog {
  info: (fields: object, message: string) => void;
  warn: (fields: object, message: string) => void;
  error: (fields: object, message: string) => void;
}

interface ActiveCallRow {
  id: string;
  stream_id: string;
  stream_kind: "conversation" | "channel";
  livekit_room: string;
  answered_by: string[];
}

interface MediaCommandRow {
  id: string;
  action: "delete_room" | "remove_participant";
  livekit_room: string;
  participant_identity: string | null;
  revoke_token_ts: string | null;
  attempts: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function revocationTimestamp(now = Date.now()): bigint {
  return BigInt(Math.floor(now / 1_000));
}

export function retryDelaySeconds(attempt: number): number {
  return Math.min(60, Math.max(1, 2 ** Math.max(0, attempt - 1)));
}

export const MAX_MEDIA_CONTROL_ATTEMPTS = 12;

export function sanitizedMediaErrorCode(error: unknown): string {
  if (!error || typeof error !== "object") return "unknown";
  const value = error as { code?: unknown; status?: unknown; statusCode?: unknown; name?: unknown };
  for (const candidate of [value.code, value.status, value.statusCode, value.name]) {
    if (typeof candidate === "string" && /^[A-Za-z0-9_.-]{1,64}$/.test(candidate)) return candidate.toLowerCase();
    if (typeof candidate === "number" && Number.isSafeInteger(candidate)) return String(candidate);
  }
  return "unknown";
}

export async function enqueueRoomTermination(
  client: Pick<DbClient, "query">,
  callId: string,
  roomName: string,
  reason: string,
): Promise<void> {
  await client.query(
    `INSERT INTO call_media_commands(call_session_id,action,livekit_room,reason)
     VALUES ($1,'delete_room',$2,$3) ON CONFLICT DO NOTHING`,
    [callId, roomName, reason],
  );
}

export async function enqueueParticipantRevocation(
  client: Pick<DbClient, "query">,
  callId: string,
  roomName: string,
  identity: string,
  reason: string,
  revokedAt = revocationTimestamp(),
): Promise<void> {
  await client.query(
    `INSERT INTO call_media_commands(call_session_id,action,livekit_room,participant_identity,revoke_token_ts,reason)
     VALUES ($1,'remove_participant',$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
    [callId, roomName, identity, revokedAt.toString(), reason],
  );
}

export async function endActiveCallsForConversation(
  client: DbClient,
  conversationId: string,
  reason: CallEndReason,
): Promise<StoredEvent[]> {
  const calls = await client.query<ActiveCallRow>(
    `UPDATE call_sessions SET ended_at=now()
     WHERE stream_kind='conversation' AND stream_id=$1 AND ended_at IS NULL
     RETURNING id,stream_id,stream_kind,livekit_room,answered_by`,
    [conversationId],
  );
  const events: StoredEvent[] = [];
  for (const call of calls.rows) {
    await enqueueRoomTermination(client, call.id, call.livekit_room, reason);
    events.push(await endedEvent(client, call, reason));
  }
  return events;
}

export async function revokeConversationParticipantMedia(
  client: DbClient,
  conversationId: string,
  userId: string,
  reason: CallEndReason,
): Promise<StoredEvent[]> {
  // A disconnected or not-yet-joined identity cannot be reliably revoked by
  // LiveKit's participant API. Ending the shared room is the only fail-closed
  // way to make an already issued grant unusable after membership removal.
  void userId;
  return endActiveCallsForConversation(client, conversationId, reason);
}

export async function terminateDirectCallsBetween(
  client: DbClient,
  firstUserId: string,
  secondUserId: string,
  reason: CallEndReason,
): Promise<StoredEvent[]> {
  const conversations = await client.query<{ id: string }>(
    `SELECT c.id FROM conversations c
     WHERE c.kind='direct'
       AND EXISTS(SELECT 1 FROM conversation_members first_member WHERE first_member.conversation_id=c.id AND first_member.user_id=$1)
       AND EXISTS(SELECT 1 FROM conversation_members second_member WHERE second_member.conversation_id=c.id AND second_member.user_id=$2)`,
    [firstUserId, secondUserId],
  );
  const events: StoredEvent[] = [];
  for (const conversation of conversations.rows) events.push(...await endActiveCallsForConversation(client, conversation.id, reason));
  return events;
}

export async function terminateCallsForUser(client: DbClient, userId: string, reason: CallEndReason): Promise<StoredEvent[]> {
  const calls = await client.query<ActiveCallRow>(
    `UPDATE call_sessions call SET ended_at=now()
     WHERE call.ended_at IS NULL AND (
       (call.stream_kind='conversation' AND EXISTS(
         SELECT 1 FROM conversation_members member
         WHERE member.conversation_id=call.stream_id AND member.user_id=$1
       )) OR
       (call.stream_kind='channel' AND EXISTS(
         SELECT 1 FROM channels channel
         JOIN server_members member ON member.server_id=channel.server_id
         WHERE channel.id=call.stream_id AND member.user_id=$1
       ))
     )
     RETURNING call.id,call.stream_id,call.stream_kind,call.livekit_room,call.answered_by`,
    [userId],
  );
  const events: StoredEvent[] = [];
  for (const call of calls.rows) {
    await enqueueRoomTermination(client, call.id, call.livekit_room, reason);
    events.push(await endedEvent(client, call, reason));
  }
  return events;
}

export async function terminateServerCalls(client: DbClient, serverId: string, reason: CallEndReason): Promise<StoredEvent[]> {
  const channels = await client.query<{ id: string }>(
    `SELECT DISTINCT channel.id FROM channels channel JOIN call_sessions call ON call.stream_kind='channel' AND call.stream_id=channel.id
     WHERE channel.server_id=$1 AND call.ended_at IS NULL`,
    [serverId],
  );
  return terminateChannelCalls(client, channels.rows.map((channel) => channel.id), reason);
}

export async function terminateChannelCalls(client: DbClient, channelIds: string[], reason: CallEndReason): Promise<StoredEvent[]> {
  if (!channelIds.length) return [];
  const calls = await client.query<ActiveCallRow>(
    `UPDATE call_sessions SET ended_at=now()
     WHERE stream_kind='channel' AND stream_id=ANY($1::uuid[]) AND ended_at IS NULL
     RETURNING id,stream_id,stream_kind,livekit_room,answered_by`,
    [channelIds],
  );
  const events: StoredEvent[] = [];
  for (const call of calls.rows) {
    await enqueueRoomTermination(client, call.id, call.livekit_room, reason);
    events.push(await endedEvent(client, call, reason));
  }
  return events;
}

export async function recordParticipantJoined(roomName: string, identity: string): Promise<void> {
  await transaction(async (client) => {
    const call = (await client.query<ActiveCallRow & { ended_at: Date | null }>(
      `SELECT id,stream_id,stream_kind,livekit_room,answered_by,ended_at FROM call_sessions WHERE livekit_room=$1 FOR UPDATE`,
      [roomName],
    )).rows[0];
    if (!call) return;
    if (!UUID.test(identity) || call.ended_at || !await participantStillAuthorized(client, call, identity)) {
      await enqueueParticipantRevocation(client, call.id, roomName, identity, call.ended_at ? "call-ended" : "access-revoked");
      return;
    }
    await client.query("UPDATE call_sessions SET first_participant_joined_at=coalesce(first_participant_joined_at,now()) WHERE id=$1", [call.id]);
    await client.query(
      `INSERT INTO call_participant_presence(call_session_id,user_id) VALUES ($1,$2)
       ON CONFLICT(call_session_id,user_id) DO UPDATE SET last_joined_at=now(),left_at=NULL,join_count=call_participant_presence.join_count+1`,
      [call.id, identity],
    );
  });
}

export async function recordParticipantLeft(roomName: string, identity: string): Promise<void> {
  if (!UUID.test(identity)) return;
  await pool.query(
    `UPDATE call_participant_presence presence SET left_at=now()
     FROM call_sessions call WHERE presence.call_session_id=call.id AND call.livekit_room=$1 AND presence.user_id=$2`,
    [roomName, identity],
  );
  await pool.query("UPDATE call_sessions SET last_participant_left_at=now() WHERE livekit_room=$1", [roomName]);
}

export async function endCallFromRoom(roomName: string, reason: CallEndReason = "room-finished"): Promise<void> {
  const event = await transaction(async (client) => {
    const call = (await client.query<ActiveCallRow & { ended_at: Date }>(
      `UPDATE call_sessions SET ended_at=now() WHERE livekit_room=$1 AND ended_at IS NULL
       RETURNING id,stream_id,stream_kind,livekit_room,answered_by,ended_at`,
      [roomName],
    )).rows[0];
    return call ? endedEvent(client, call, reason, call.ended_at) : null;
  });
  if (event) {
    publishStoredEvent(event);
    incrementMetric("calls.ended.webhook");
  }
}

export async function expirePhantomCallSessions(): Promise<number> {
  const events = await transaction(async (client) => {
    const expired = await client.query<ActiveCallRow & { ended_at: Date }>(
      `UPDATE call_sessions SET ended_at=now()
       WHERE ended_at IS NULL AND first_participant_joined_at IS NULL
         AND started_at<now()-($1::text||' seconds')::interval
       RETURNING id,stream_id,stream_kind,livekit_room,answered_by,ended_at`,
      [config.CALL_PHANTOM_TIMEOUT_SECONDS],
    );
    const stored: StoredEvent[] = [];
    for (const call of expired.rows) {
      await enqueueRoomTermination(client, call.id, call.livekit_room, "no-participant-timeout");
      stored.push(await endedEvent(client, call, "no-participant-timeout", call.ended_at));
    }
    return stored;
  });
  events.forEach(publishStoredEvent);
  if (events.length) incrementMetric("calls.ended.phantom", events.length);
  return events.length;
}

export async function drainCallMediaCommands(log: MaintenanceLog, mediaPlane: CallMediaPlane = getCallMediaPlane(), limit = 25): Promise<number> {
  let processed = 0;
  while (processed < limit) {
    const command = await claimCommand();
    if (!command) break;
    try {
      if (command.action === "delete_room") await mediaPlane.terminateRoom(command.livekit_room, revocationTimestamp());
      else await mediaPlane.removeParticipant(command.livekit_room, command.participant_identity!, BigInt(command.revoke_token_ts!));
      await pool.query("UPDATE call_media_commands SET status='completed',lease_until=NULL,last_error_code=NULL,completed_at=now(),updated_at=now() WHERE id=$1 AND status='processing'", [command.id]);
      incrementMetric(`calls.media_control.${command.action}.completed`);
    } catch (error) {
      const code = sanitizedMediaErrorCode(error);
      const retrySeconds = retryDelaySeconds(command.attempts);
      const exhausted = command.attempts >= MAX_MEDIA_CONTROL_ATTEMPTS;
      await pool.query(
        `UPDATE call_media_commands SET status=CASE WHEN $4 THEN 'failed' ELSE 'pending' END,lease_until=NULL,last_error_code=$2,
         available_at=CASE WHEN $4 THEN available_at ELSE now()+($3::text||' seconds')::interval END,
         completed_at=CASE WHEN $4 THEN now() ELSE NULL END,updated_at=now() WHERE id=$1 AND status='processing'`,
        [command.id, code, retrySeconds, exhausted],
      );
      log.warn({ commandId: command.id, action: command.action, code, retrySeconds }, "LiveKit media-control command deferred");
      incrementMetric(`calls.media_control.${command.action}.deferred`);
      if (exhausted) incrementMetric(`calls.media_control.${command.action}.failed`);
    }
    processed += 1;
  }
  return processed;
}

export function requestCallMediaDrain(log: MaintenanceLog): void {
  // The API only emits a low-latency hint. External LiveKit I/O belongs to the
  // separately supervised domain worker, whose durable poll remains canonical.
  void pool.query("SELECT pg_notify('snezhok_jobs','call-media')").catch((error) => {
    log.error({ code: sanitizedMediaErrorCode(error) }, "call media-control wake hint failed");
  });
}

export function startCallMediaControlWorker(log: MaintenanceLog): () => void {
  let stopped = false;
  let active = false;
  let ticks = 0;
  const run = async () => {
    if (stopped || active) return;
    active = true;
    try {
      ticks += 1;
      if (ticks === 1 || ticks % 5 === 0) await expirePhantomCallSessions();
      await drainCallMediaCommands(log);
    } catch (error) {
      log.error({ code: sanitizedMediaErrorCode(error) }, "call media-control maintenance failed");
    } finally {
      active = false;
    }
  };
  const timer = setInterval(() => void run(), 1_000);
  timer.unref();
  void run();
  return () => { stopped = true; clearInterval(timer); };
}

async function claimCommand(): Promise<MediaCommandRow | null> {
  return transaction(async (client) => {
    const row = (await client.query<MediaCommandRow>(
      `WITH candidate AS (
         SELECT id FROM call_media_commands
         WHERE (status='pending' AND available_at<=now()) OR (status='processing' AND lease_until<now())
         ORDER BY available_at,id LIMIT 1 FOR UPDATE SKIP LOCKED
       )
       UPDATE call_media_commands command SET status='processing',attempts=command.attempts+1,
         lease_until=now()+interval '30 seconds',updated_at=now()
       FROM candidate WHERE command.id=candidate.id
       RETURNING command.id::text,command.action,command.livekit_room,command.participant_identity,command.revoke_token_ts::text,command.attempts`,
    )).rows[0];
    return row ?? null;
  });
}

async function participantStillAuthorized(client: DbClient, call: ActiveCallRow, userId: string): Promise<boolean> {
  try {
    const access = await resolveStreamAccess(userId, call.stream_id, client);
    if (access.streamKind === "channel") return access.channelKind === "voice" && voiceChannelGrantPolicy(access.serverPermissions).canConnect;
    await assertDirectConversationMessagingAllowed(userId, call.stream_id, client);
    return true;
  } catch (error) {
    if (error instanceof AppError && (error.status === 403 || error.status === 404)) return false;
    throw error;
  }
}

async function endedEvent(client: DbClient, call: ActiveCallRow, reason: CallEndReason, endedAt = new Date()): Promise<StoredEvent> {
  const access: StreamAccess = {
    streamId: call.stream_id,
    streamKind: call.stream_kind,
    serverId: null,
    memberRole: "owner",
    channelKind: null,
    serverPermissions: [],
  };
  if (call.stream_kind === "channel") {
    access.serverId = (await client.query<{ server_id: string }>("SELECT server_id FROM channels WHERE id=$1", [call.stream_id])).rows[0]?.server_id ?? null;
  }
  const recipients = await streamRecipients(access, client);
  return storeEvent(client, recipients, "call:updated", {
    roomId: call.id,
    state: "ended",
    participantIds: [],
    streamId: call.stream_id,
    streamKind: call.stream_kind,
    endedAt: endedAt.getTime(),
    answeredByIds: call.answered_by,
    reason,
  });
}
