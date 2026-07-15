import type { Server as HttpServer } from "node:http";
import type { ClientToServerEvents, ServerToClientEvents } from "@snezhok/contracts";
import { Server } from "socket.io";
import { config } from "../../config.js";
import { authenticateAccessToken } from "../auth/service.js";
import { eventsAfter, currentCursor, eventDelivery } from "./events.js";
import { pool } from "../../db/pool.js";
import { resolveStreamAccess } from "../streams/access.js";
import { markRead } from "../messages/service.js";
import { deliverPushEvent } from "../notifications/push.js";
import { incrementMetric } from "../../lib/metrics.js";

type InterServerEvents = Record<string, never>;
interface SocketData { userId: string; }

export async function setupRealtime(server: HttpServer) {
  const io = new Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>(server, {
    path: "/socket.io", cors: { origin: config.APP_ORIGINS, credentials: true }, transports: ["websocket", "polling"], maxHttpBufferSize: 64 * 1024,
  });
  const connections = new Map<string, number>();

  io.use(async (socket, next) => {
    try {
      const token = typeof socket.handshake.auth.token === "string" ? socket.handshake.auth.token : cookie(socket.handshake.headers.cookie, "access_token");
      if (!token) throw new Error("missing token");
      const user = await authenticateAccessToken(token); socket.data.userId = user.id; next();
    } catch { next(new Error("Authentication required")); }
  });

  io.on("connection", async (socket) => {
    const userId = socket.data.userId; socket.join(`user:${userId}`);
    connections.set(userId, (connections.get(userId) ?? 0) + 1);
    for (const recipient of await presenceRecipients(userId)) io.to(`user:${recipient}`).emit("presence:updated", { userId, presence: "online", lastSeenAt: Date.now() });
    socket.emit("sync:ready", { cursor: await currentCursor(userId), serverTime: Date.now() });

    socket.on("sync:resume", async ({ cursor }, acknowledge) => {
      try {
        const events = await eventsAfter(userId, cursor);
        for (const event of events) socket.emit(event.name as keyof ServerToClientEvents, event.payload as never);
        socket.emit("sync:ready", { cursor: events.at(-1)?.cursor ?? await currentCursor(userId), serverTime: Date.now() });
        acknowledge(true);
      } catch { acknowledge(false); }
    });
    socket.on("stream:join", async ({ streamId }, acknowledge) => {
      try { await resolveStreamAccess(userId, streamId); await socket.join(`stream:${streamId}`); acknowledge(true); } catch { acknowledge(false); }
    });
    socket.on("stream:leave", ({ streamId }) => { void socket.leave(`stream:${streamId}`); });
    socket.on("typing:set", async ({ streamId, typing }) => {
      try { await resolveStreamAccess(userId, streamId); socket.to(`stream:${streamId}`).volatile.emit("typing:updated", { streamId, userId, typing }); } catch { /* unauthorized */ }
    });
    socket.on("read:set", async ({ streamId, sequence }) => { try { await markRead(userId, streamId, sequence); } catch { /* HTTP sync will reconcile */ } });
    socket.on("disconnect", () => {
      const remaining = Math.max(0, (connections.get(userId) ?? 1) - 1);
      if (remaining) connections.set(userId, remaining); else {
        connections.delete(userId);
        void presenceRecipients(userId).then((recipients) => recipients.forEach((recipient) => io.to(`user:${recipient}`).emit("presence:updated", { userId, presence: "offline", lastSeenAt: Date.now() })));
      }
    });
  });

  const listener = await pool.connect();
  await listener.query("LISTEN snezhok_events");
  listener.on("notification", (notification) => {
    if (!notification.payload) return;
    void eventDelivery(notification.payload).then((deliveries) => {
      for (const delivery of deliveries) {
        io.to(`user:${delivery.userId}`).emit(delivery.name as keyof ServerToClientEvents, delivery.payload as never);
        io.to(`user:${delivery.userId}`).emit("sync:ready", { cursor: delivery.cursor, serverTime: Date.now() });
        void deliverPushEvent(delivery.userId, delivery.name, delivery.payload)
          .then(() => incrementMetric("push.delivery.processed"))
          .catch((error) => { incrementMetric("push.delivery.failed"); console.warn("Push delivery failed", error); });
      }
    });
  });
  server.once("close", () => { void listener.query("UNLISTEN snezhok_events").finally(() => listener.release()); });
  return io;
}

async function presenceRecipients(userId: string) {
  const visible = await pool.query<{ visible: boolean }>("SELECT coalesce((settings->>'showLastSeen')::boolean,true) visible FROM user_settings WHERE user_id=$1", [userId]);
  if (visible.rows[0]?.visible === false) return [];
  const result = await pool.query<{ user_id: string }>(
    `SELECT DISTINCT user_id FROM (
       SELECT CASE WHEN user_low_id=$1 THEN user_high_id ELSE user_low_id END user_id FROM friendships WHERE user_low_id=$1 OR user_high_id=$1
       UNION SELECT cm2.user_id FROM conversation_members cm1 JOIN conversation_members cm2 ON cm2.conversation_id=cm1.conversation_id WHERE cm1.user_id=$1 AND cm2.user_id<>$1
       UNION SELECT sm2.user_id FROM server_members sm1 JOIN server_members sm2 ON sm2.server_id=sm1.server_id WHERE sm1.user_id=$1 AND sm2.user_id<>$1
     ) peers`, [userId]);
  return result.rows.map((row) => row.user_id);
}

function cookie(header: string | undefined, name: string) {
  if (!header) return undefined;
  for (const part of header.split(";")) { const [key, ...value] = part.trim().split("="); if (key === name) return decodeURIComponent(value.join("=")); }
  return undefined;
}
