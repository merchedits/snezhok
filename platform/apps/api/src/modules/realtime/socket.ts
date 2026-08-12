import type { Server as HttpServer } from "node:http";
import type { ClientToServerEvents, ServerToClientEvents } from "@snezhok/contracts";
import { Server } from "socket.io";
import { config } from "../../config.js";
import { authenticateAccessToken } from "../auth/service.js";
import { eventDelivery, replayEvents } from "./events.js";
import { pool } from "../../db/pool.js";
import { resolveStreamAccess } from "../streams/access.js";
import { markRead } from "../messages/service.js";
import { assertDirectConversationMessagingAllowed } from "../users/privacy.js";

type InterServerEvents = Record<string, never>;
interface SocketData { userId: string; }
let listenerHealthy = false;

export function realtimeListenerHealthy() { return listenerHealthy; }

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

  io.on("connection", (socket) => {
    const userId = socket.data.userId;
    void socket.join(`user:${userId}`);
    const previousConnections = connections.get(userId) ?? 0;
    connections.set(userId, previousConnections + 1);

    // Register every handler synchronously. Awaiting presence/database work
    // before this point can drop a sync:resume emitted immediately on connect.
    let replaying = false;
    const drawingSequences = new Map<string, { sequence: number; emittedAt: number }>();
    const authorizedDrawings = new Map<string, { streamId: string; expiresAt: number }>();
    socket.on("sync:resume", async ({ cursor }, acknowledge) => {
      if (replaying) { acknowledge(false); return; }
      replaying = true;
      try {
        const replay = await replayEvents(userId, cursor, (event) => {
          socket.emit(event.name as keyof ServerToClientEvents, event.payload as never);
        });
        if (replay.accepted) socket.emit("sync:ready", { cursor: replay.cursor, serverTime: Date.now() });
        acknowledge(replay.accepted);
      } catch { acknowledge(false); }
      finally { replaying = false; }
    });
    socket.on("stream:join", async ({ streamId }, acknowledge) => {
      try { await resolveStreamAccess(userId, streamId); await socket.join(`stream:${streamId}`); acknowledge(true); } catch { acknowledge(false); }
    });
    socket.on("stream:leave", ({ streamId }) => { void socket.leave(`stream:${streamId}`); });
    socket.on("typing:set", async ({ streamId, typing }) => {
      try {
        const access = await resolveStreamAccess(userId, streamId);
        if (access.streamKind === "conversation") await assertDirectConversationMessagingAllowed(userId, streamId);
        socket.to(`stream:${streamId}`).volatile.emit("typing:updated", { streamId, userId, typing });
      } catch { /* unauthorized */ }
    });
    socket.on("activity:drawing:set", async ({ streamId, activityId, sequence, strokes }) => {
      try {
        const previous = drawingSequences.get(activityId);
        const now = Date.now();
        if (!Number.isSafeInteger(sequence) || sequence < 0 || (previous && sequence <= previous.sequence) || (previous && now - previous.emittedAt < 60)) return;
        if (!validLiveDrawing(strokes)) return;
        const cached = authorizedDrawings.get(activityId);
        if (!cached || cached.streamId !== streamId || cached.expiresAt <= now) {
          const activity = (await pool.query<{ conversation_id: string; drawer_id: string }>(
            `SELECT activity.conversation_id,activity.config->>'drawerId' drawer_id
               FROM cooperative_activities activity
               JOIN conversations conversation ON conversation.id=activity.conversation_id AND conversation.kind='direct'
               JOIN conversation_members member ON member.conversation_id=activity.conversation_id AND member.user_id=$2
               JOIN cooperative_activity_participants participant ON participant.activity_id=activity.id AND participant.user_id=$2
              WHERE activity.id=$1 AND activity.conversation_id=$3 AND activity.type='draw-guess'
                AND activity.state IN ('active','waiting')`,
            [activityId, userId, streamId],
          )).rows[0];
          if (!activity || activity.drawer_id !== userId) return;
          authorizedDrawings.set(activityId, { streamId, expiresAt: now + 10_000 });
        }
        drawingSequences.set(activityId, { sequence, emittedAt: now });
        socket.to(`stream:${streamId}`).volatile.emit("activity:drawing:updated", { streamId, activityId, userId, sequence, strokes });
      } catch { /* malformed or unauthorized ephemeral drawing */ }
    });
    socket.on("read:set", async ({ streamId, sequence }) => { try { await markRead(userId, streamId, sequence); } catch { /* HTTP sync will reconcile */ } });
    socket.on("disconnect", () => {
      const remaining = Math.max(0, (connections.get(userId) ?? 1) - 1);
      if (remaining) connections.set(userId, remaining); else {
        connections.delete(userId);
        const lastSeenAt = Date.now();
        void pool.query("UPDATE users SET last_seen_at=to_timestamp($2::double precision/1000),updated_at=now() WHERE id=$1", [userId, lastSeenAt]);
        void presenceRecipients(userId).then((recipients) => recipients.forEach((recipient) => io.to(`user:${recipient}`).emit("presence:updated", { userId, presence: "offline", lastSeenAt })));
      }
    });
    if (previousConnections === 0) {
      const onlineAt = Date.now();
      void presenceRecipients(userId).then((recipients) => {
        if (!socket.connected) return;
        recipients.forEach((recipient) => io.to(`user:${recipient}`).emit("presence:updated", { userId, presence: "online", lastSeenAt: onlineAt }));
      });
    }
  });

  let stopped = false;
  let retryAttempt = 0;
  let reconnectTimer: NodeJS.Timeout | null = null;
  let activeListener: { close: (graceful: boolean) => void } | null = null;
  const notification = (notification: { payload?: string | undefined; channel: string }) => {
    if (!notification.payload) return;
    if (notification.channel === "snezhok_admin") {
      io.in(`user:${notification.payload}`).disconnectSockets(true);
      return;
    }
    void eventDelivery(notification.payload).then((deliveries) => {
      for (const delivery of deliveries) {
        io.to(`user:${delivery.userId}`).emit(delivery.name as keyof ServerToClientEvents, delivery.payload as never);
        io.to(`user:${delivery.userId}`).emit("sync:ready", { cursor: delivery.cursor, serverTime: Date.now() });
      }
    }).catch((error) => console.error("Realtime event delivery failed", error));
  };
  const scheduleReconnect = () => {
    if (stopped || reconnectTimer) return;
    const delay = Math.min(30_000, 250 * (2 ** Math.min(retryAttempt, 7)));
    retryAttempt += 1;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      void connectListener();
    }, delay);
    reconnectTimer.unref();
  };
  const connectListener = async () => {
    if (stopped || activeListener) return;
    let listener;
    try {
      listener = await pool.connect();
    } catch (error) {
      listenerHealthy = false;
      console.error("Realtime PostgreSQL listener connection failed", error);
      scheduleReconnect();
      return;
    }
    let closed = false;
    const close = (graceful: boolean) => {
      if (closed) return;
      closed = true;
      listenerHealthy = false;
      listener.removeListener("notification", notification);
      if (activeListener?.close === close) activeListener = null;
      if (graceful) {
        void listener.query("UNLISTEN *").then(() => {
          listener.removeListener("error", onError);
          listener.release();
        }).catch(() => {
          listener.removeListener("error", onError);
          listener.release(true);
        });
      } else {
        listener.removeListener("error", onError);
        listener.release(true);
      }
      if (!stopped) scheduleReconnect();
    };
    const onError = (error: Error) => {
      console.error("Realtime PostgreSQL listener lost", error);
      close(false);
    };
    activeListener = { close };
    listener.once("error", onError);
    listener.on("notification", notification);
    try {
      await listener.query("LISTEN snezhok_events");
      await listener.query("LISTEN snezhok_admin");
      listenerHealthy = true;
      retryAttempt = 0;
    } catch (error) {
      console.error("Realtime PostgreSQL LISTEN failed", error);
      close(false);
    }
  };
  await connectListener();
  server.once("close", () => {
    stopped = true;
    listenerHealthy = false;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = null;
    activeListener?.close(true);
    activeListener = null;
  });
  return io;
}

export function validLiveDrawing(value: unknown): value is number[][][] {
  if (!Array.isArray(value) || value.length > 200) return false;
  let points = 0;
  for (const stroke of value) {
    if (!Array.isArray(stroke) || stroke.length < 2 || stroke.length > 500) return false;
    points += stroke.length;
    if (points > 2_000) return false;
    for (const point of stroke) {
      if (!Array.isArray(point) || point.length !== 2 || typeof point[0] !== "number" || !Number.isFinite(point[0]) || point[0] < 0 || point[0] > 300 || typeof point[1] !== "number" || !Number.isFinite(point[1]) || point[1] < 0 || point[1] > 240) return false;
    }
  }
  return true;
}

export async function presenceRecipients(userId: string) {
  const visible = await pool.query<{ visible: boolean }>("SELECT coalesce((settings->>'showLastSeen')::boolean,true) visible FROM user_settings WHERE user_id=$1", [userId]);
  if (visible.rows[0]?.visible === false) return [];
  const result = await pool.query<{ user_id: string }>(presenceRecipientsSql, [userId]);
  return result.rows.map((row) => row.user_id);
}

export const presenceRecipientsSql = `SELECT DISTINCT peers.user_id FROM (
       SELECT CASE WHEN user_low_id=$1 THEN user_high_id ELSE user_low_id END user_id
       FROM friendships WHERE user_low_id=$1 OR user_high_id=$1
     ) peers JOIN users recipient ON recipient.id=peers.user_id AND recipient.deleted_at IS NULL
     WHERE NOT EXISTS(SELECT 1 FROM user_blocks block
       WHERE (block.blocker_id=$1 AND block.blocked_id=peers.user_id)
          OR (block.blocker_id=peers.user_id AND block.blocked_id=$1))`;

function cookie(header: string | undefined, name: string) {
  if (!header) return undefined;
  for (const part of header.split(";")) { const [key, ...value] = part.trim().split("="); if (key === name) return decodeURIComponent(value.join("=")); }
  return undefined;
}
