import type { FastifyInstance } from "fastify";
import { AccessToken, WebhookReceiver } from "livekit-server-sdk";
import { z } from "zod";
import { config } from "../../config.js";
import { pool, transaction } from "../../db/pool.js";
import { forbidden, notFound } from "../../lib/errors.js";
import { newId } from "../../lib/ids.js";
import { requireAuth } from "../auth/middleware.js";
import { publishStoredEvent, storeEvent } from "../realtime/events.js";
import { resolveStreamAccess, streamRecipients, type StreamAccess } from "../streams/access.js";

const tokenSchema = z.object({ streamId: z.string().uuid() });
const callParams = z.object({ id: z.string().uuid() });
const webhookReceiver = new WebhookReceiver(config.LIVEKIT_API_KEY, config.LIVEKIT_API_SECRET);

export async function callRoutes(app: FastifyInstance) {
  app.post("/calls/token", { preHandler: requireAuth }, async (request) => {
    const { streamId } = tokenSchema.parse(request.body);
    const result = await transaction(async (client) => {
      const access = await resolveStreamAccess(request.auth.id, streamId, client);
      if (access.streamKind === "channel" && access.channelKind !== "voice") throw forbidden("Join the voice channel, not a text channel");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`call:${access.streamKind}:${streamId}`]);
      const stale = await client.query<{ id: string }>(
        "UPDATE call_sessions SET ended_at=now() WHERE stream_kind=$1 AND stream_id=$2 AND ended_at IS NULL AND started_at < now()-($3::text || ' hours')::interval RETURNING id",
        [access.streamKind, streamId, config.CALL_STALE_HOURS],
      );
      const recipients = await streamRecipients(access, client);
      for (const old of stale.rows) await storeEvent(client, recipients, "call:updated", { roomId: old.id, state: "ended", participantIds: [] });
      let call = (await client.query<{ id: string; livekit_room: string }>("SELECT id,livekit_room FROM call_sessions WHERE stream_kind=$1 AND stream_id=$2 AND ended_at IS NULL LIMIT 1", [access.streamKind, streamId])).rows[0];
      let event = null;
      if (!call) {
        const id = newId(); const livekitRoom = `snezhok-${id}`;
        await client.query("INSERT INTO call_sessions(id,stream_kind,stream_id,livekit_room,started_by) VALUES ($1,$2,$3,$4,$5)", [id, access.streamKind, streamId, livekitRoom, request.auth.id]);
        const payload = { roomId: id, state: "started" as const, participantIds: [request.auth.id] };
        event = await storeEvent(client, recipients, "call:updated", payload); call = { id, livekit_room: livekitRoom };
      }
      return { call, event };
    });
    if (result.event) publishStoredEvent(result.event);
    const call = result.call!;
    const token = new AccessToken(config.LIVEKIT_API_KEY, config.LIVEKIT_API_SECRET, { identity: request.auth.id, name: request.auth.displayName, ttl: "5m" });
    token.addGrant({ roomJoin: true, room: call.livekit_room, canPublish: true, canSubscribe: true, canPublishData: true });
    return { callId: call.id, roomName: call.livekit_room, url: config.LIVEKIT_URL, token: await token.toJwt() };
  });

  app.post("/calls/:id/end", { preHandler: requireAuth }, async (request) => {
    const { id } = callParams.parse(request.params);
    const result = await transaction(async (client) => {
      const call = (await client.query<{ stream_id: string; stream_kind: "conversation" | "channel"; started_by: string }>("SELECT stream_id,stream_kind,started_by FROM call_sessions WHERE id=$1 AND ended_at IS NULL FOR UPDATE", [id])).rows[0];
      if (!call) throw notFound("Active call not found");
      const access = await resolveStreamAccess(request.auth.id, call.stream_id, client);
      if (!canEndCall(request.auth.id, call.started_by, access.memberRole)) throw forbidden("Only the call starter or a moderator can end this call");
      await client.query("UPDATE call_sessions SET ended_at=now() WHERE id=$1", [id]);
      const recipients = await streamRecipients(access, client);
      return storeEvent(client, recipients, "call:updated", { roomId: id, state: "ended", participantIds: [] });
    });
    publishStoredEvent(result); return { success: true };
  });

  app.post("/livekit/webhook", async (request) => {
    if (typeof request.body !== "string") throw forbidden("Raw webhook body is required");
    const event = await webhookReceiver.receive(request.body, request.headers.authorization);
    if (event.event === "room_finished" && event.room?.name) await endCallByRoom(event.room.name);
    return { received: true };
  });
}
export function canEndCall(actorId: string, startedBy: string, role: "owner" | "admin" | "moderator" | "member") { return actorId === startedBy || role === "owner" || role === "admin" || role === "moderator"; }

async function endCallByRoom(roomName: string) {
  const event = await transaction(async (client) => {
    const call = (await client.query<{ id: string; stream_id: string; stream_kind: "conversation" | "channel" }>("UPDATE call_sessions SET ended_at=now() WHERE livekit_room=$1 AND ended_at IS NULL RETURNING id,stream_id,stream_kind", [roomName])).rows[0];
    if (!call) return null;
    const access: StreamAccess = { streamId: call.stream_id, streamKind: call.stream_kind, serverId: null, memberRole: "owner", channelKind: null };
    if (call.stream_kind === "channel") access.serverId = (await client.query<{ server_id: string }>("SELECT server_id FROM channels WHERE id=$1", [call.stream_id])).rows[0]?.server_id ?? null;
    const recipients = await streamRecipients(access, client);
    return storeEvent(client, recipients, "call:updated", { roomId: call.id, state: "ended", participantIds: [] });
  });
  if (event) publishStoredEvent(event);
}
