import type { FastifyInstance } from "fastify";
import { AccessToken, WebhookReceiver } from "livekit-server-sdk";
import { z } from "zod";
import { config } from "../../config.js";
import { pool, transaction, type DbClient } from "../../db/pool.js";
import { forbidden, notFound } from "../../lib/errors.js";
import { newId } from "../../lib/ids.js";
import { incrementMetric } from "../../lib/metrics.js";
import { requireAuth } from "../auth/middleware.js";
import { publishStoredEvent, storeEvent } from "../realtime/events.js";
import { resolveStreamAccess, streamRecipients, type StreamAccess } from "../streams/access.js";

const tokenSchema = z.object({ streamId: z.string().uuid() });
const callParams = z.object({ id: z.string().uuid() });
const webhookReceiver = new WebhookReceiver(config.LIVEKIT_API_KEY, config.LIVEKIT_API_SECRET);

export async function callRoutes(app: FastifyInstance) {
  app.post("/calls/token", { preHandler: requireAuth }, async (request) => {
    incrementMetric("calls.token.requested");
    const { streamId } = tokenSchema.parse(request.body);
    const result = await transaction(async (client) => {
      const access = await resolveStreamAccess(request.auth.id, streamId, client);
      if (access.streamKind === "channel" && access.channelKind !== "voice") throw forbidden("Join the voice channel, not a text channel");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`call:${access.streamKind}:${streamId}`]);
      const stale = await client.query<{ id: string; ended_at: Date; answered_by: string[] }>(
        "UPDATE call_sessions SET ended_at=now() WHERE stream_kind=$1 AND stream_id=$2 AND ended_at IS NULL AND started_at < now()-($3::text || ' hours')::interval RETURNING id,ended_at,answered_by",
        [access.streamKind, streamId, config.CALL_STALE_HOURS],
      );
      const recipients = await streamRecipients(access, client);
      for (const old of stale.rows) await storeEvent(client, recipients, "call:updated", { roomId: old.id, state: "ended", participantIds: [], endedAt: old.ended_at.getTime(), answeredByIds: old.answered_by, reason: "stale-timeout" });
      let call = (await client.query<{ id: string; livekit_room: string; started_by: string }>("SELECT id,livekit_room,started_by FROM call_sessions WHERE stream_kind=$1 AND stream_id=$2 AND ended_at IS NULL LIMIT 1", [access.streamKind, streamId])).rows[0];
      let event = null;
      if (!call) {
        const id = newId(); const livekitRoom = `snezhok-${id}`;
        await client.query("INSERT INTO call_sessions(id,stream_kind,stream_id,livekit_room,started_by) VALUES ($1,$2,$3,$4,$5)", [id, access.streamKind, streamId, livekitRoom, request.auth.id]);
        const title = await callTitle(access, request.auth.displayName, client);
        const payload = {
          roomId: id,
          state: "started" as const,
          participantIds: [request.auth.id],
          streamId,
          streamKind: access.streamKind,
          title,
          callerId: request.auth.id,
          callerName: request.auth.displayName,
          startedAt: Date.now(),
        };
        event = await storeEvent(client, recipients, "call:updated", payload); call = { id, livekit_room: livekitRoom, started_by: request.auth.id };
        incrementMetric("calls.started");
      } else if (call.started_by !== request.auth.id) {
        const answered = await client.query(
          "UPDATE call_sessions SET answered_at=coalesce(answered_at,now()),answered_by=array_append(answered_by,$2::uuid) WHERE id=$1 AND NOT ($2=ANY(answered_by)) RETURNING id",
          [call.id, request.auth.id],
        );
        if (answered.rowCount) incrementMetric("calls.answered");
      }
      return { call, event };
    });
    if (result.event) publishStoredEvent(result.event);
    const call = result.call!;
    const token = new AccessToken(config.LIVEKIT_API_KEY, config.LIVEKIT_API_SECRET, { identity: request.auth.id, name: request.auth.displayName, ttl: "5m" });
    token.addGrant({ roomJoin: true, room: call.livekit_room, canPublish: true, canSubscribe: true, canPublishData: true });
    return { callId: call.id, roomName: call.livekit_room, url: config.LIVEKIT_URL, token: await token.toJwt(), canEnd: call.started_by === request.auth.id };
  });

  app.post("/calls/:id/end", { preHandler: requireAuth }, async (request) => {
    const { id } = callParams.parse(request.params);
    const result = await transaction(async (client) => {
      const call = (await client.query<{ stream_id: string; stream_kind: "conversation" | "channel"; started_by: string; answered_by: string[] }>("SELECT stream_id,stream_kind,started_by,answered_by FROM call_sessions WHERE id=$1 AND ended_at IS NULL FOR UPDATE", [id])).rows[0];
      if (!call) throw notFound("Active call not found");
      const access = await resolveStreamAccess(request.auth.id, call.stream_id, client);
      if (!canEndCall(request.auth.id, call.started_by, access.memberRole)) throw forbidden("Only the call starter or a moderator can end this call");
      const endedAt = (await client.query<{ ended_at: Date }>("UPDATE call_sessions SET ended_at=now() WHERE id=$1 RETURNING ended_at", [id])).rows[0]!.ended_at;
      const recipients = await streamRecipients(access, client);
      return storeEvent(client, recipients, "call:updated", { roomId: id, state: "ended", participantIds: [], endedAt: endedAt.getTime(), answeredByIds: call.answered_by, reason: "ended-by-user" });
    });
    publishStoredEvent(result);
    incrementMetric("calls.ended.user");
    return { success: true };
  });

  app.post("/calls/:id/decline", { preHandler: requireAuth }, async (request) => {
    const { id } = callParams.parse(request.params);
    const result = await transaction(async (client) => {
      const call = (await client.query<{ stream_id: string; stream_kind: "conversation" | "channel"; started_by: string; answered_by: string[] }>("SELECT stream_id,stream_kind,started_by,answered_by FROM call_sessions WHERE id=$1 AND ended_at IS NULL FOR UPDATE", [id])).rows[0];
      if (!call) return null;
      const access = await resolveStreamAccess(request.auth.id, call.stream_id, client);
      if (call.started_by === request.auth.id) return null;
      await client.query("UPDATE call_sessions SET declined_by=CASE WHEN $2=ANY(declined_by) THEN declined_by ELSE array_append(declined_by,$2::uuid) END WHERE id=$1", [id, request.auth.id]);
      if (call.stream_kind !== "conversation") return null;
      const direct = (await client.query<{ direct: boolean }>("SELECT kind='direct' AS direct FROM conversations WHERE id=$1", [call.stream_id])).rows[0]?.direct;
      if (!direct) return null;
      const endedAt = (await client.query<{ ended_at: Date }>("UPDATE call_sessions SET ended_at=now() WHERE id=$1 RETURNING ended_at", [id])).rows[0]!.ended_at;
      const recipients = await streamRecipients(access, client);
      return storeEvent(client, recipients, "call:updated", { roomId: id, state: "ended", participantIds: [], streamId: call.stream_id, streamKind: call.stream_kind, endedAt: endedAt.getTime(), answeredByIds: call.answered_by, reason: "declined" });
    });
    if (result) publishStoredEvent(result);
    incrementMetric(result ? "calls.declined.direct" : "calls.declined.group_or_stale");
    return { accepted: true };
  });

  app.post("/livekit/webhook", async (request) => {
    if (typeof request.body !== "string") throw forbidden("Raw webhook body is required");
    const event = await webhookReceiver.receive(request.body, request.headers.authorization);
    if (event.event === "room_finished" && event.room?.name) await endCallByRoom(event.room.name);
    return { received: true };
  });
}

async function callTitle(access: StreamAccess, fallback: string, client: Pick<DbClient, "query">) {
  if (access.streamKind === "channel") {
    return (await client.query<{ name: string }>("SELECT name FROM channels WHERE id=$1", [access.streamId])).rows[0]?.name ?? fallback;
  }
  const conversation = (await client.query<{ kind: "direct" | "group"; title: string }>("SELECT kind,title FROM conversations WHERE id=$1", [access.streamId])).rows[0];
  return conversation?.kind === "group" && conversation.title ? conversation.title : fallback;
}
export function canEndCall(actorId: string, startedBy: string, role: "owner" | "admin" | "moderator" | "member") { return actorId === startedBy || role === "owner" || role === "admin" || role === "moderator"; }

async function endCallByRoom(roomName: string) {
  const event = await transaction(async (client) => {
    const call = (await client.query<{ id: string; stream_id: string; stream_kind: "conversation" | "channel"; ended_at: Date; answered_by: string[] }>("UPDATE call_sessions SET ended_at=now() WHERE livekit_room=$1 AND ended_at IS NULL RETURNING id,stream_id,stream_kind,ended_at,answered_by", [roomName])).rows[0];
    if (!call) return null;
    const access: StreamAccess = { streamId: call.stream_id, streamKind: call.stream_kind, serverId: null, memberRole: "owner", channelKind: null };
    if (call.stream_kind === "channel") access.serverId = (await client.query<{ server_id: string }>("SELECT server_id FROM channels WHERE id=$1", [call.stream_id])).rows[0]?.server_id ?? null;
    const recipients = await streamRecipients(access, client);
    return storeEvent(client, recipients, "call:updated", { roomId: call.id, state: "ended", participantIds: [], endedAt: call.ended_at.getTime(), answeredByIds: call.answered_by, reason: "room-finished" });
  });
  if (event) publishStoredEvent(event);
  if (event) incrementMetric("calls.ended.webhook");
}
