import { pool } from "../../db/pool.js";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

export interface ExpoPushMessage {
  to: string;
  title?: string;
  body?: string;
  data: Record<string, unknown>;
  sound?: "default";
  priority?: "default" | "normal" | "high";
  channelId?: string;
  categoryId?: string;
  ttl?: number;
  collapseId?: string;
  _contentAvailable?: boolean;
}

export function pushContentForEvent(recipientId: string, name: string, payload: unknown): Omit<ExpoPushMessage, "to"> | null {
  if (!payload || typeof payload !== "object") return null;
  const value = payload as Record<string, unknown>;
  if (name === "message:created") {
    if (value.silent === true) return null;
    const sender = value.sender && typeof value.sender === "object" ? value.sender as Record<string, unknown> : null;
    if (!sender || sender.id === recipientId || typeof value.streamId !== "string") return null;
    const senderName = typeof sender.displayName === "string" ? sender.displayName : "Snezhok";
    const text = typeof value.text === "string" && value.text.trim() ? value.text.trim() : attachmentLabel(value.kind);
    return {
      title: senderName,
      body: text.slice(0, 240),
      sound: "default",
      priority: "high",
      channelId: "messages-v1",
      collapseId: `stream-${value.streamId}`.slice(0, 64),
      data: {
        notificationType: "message",
        streamId: value.streamId,
        streamKind: value.streamKind,
        title: senderName,
      },
    };
  }
  if (name === "call:updated" && value.state === "started") {
    if (value.callerId === recipientId || typeof value.streamId !== "string" || typeof value.roomId !== "string") return null;
    const caller = typeof value.callerName === "string" ? value.callerName : "Snezhok";
    return {
      title: `Входящий звонок · ${caller}`,
      body: "Нажмите, чтобы ответить",
      sound: "default",
      priority: "high",
      channelId: "calls-v1",
      categoryId: "incoming-call-v1",
      ttl: 90,
      collapseId: `call-${value.roomId}`.slice(0, 64),
      data: {
        notificationType: "call",
        roomId: value.roomId,
        streamId: value.streamId,
        title: typeof value.title === "string" ? value.title : caller,
      },
    };
  }
  if (name === "call:updated" && value.state === "ended" && typeof value.roomId === "string") {
    return {
      priority: "high",
      ttl: 30,
      collapseId: `call-${value.roomId}`.slice(0, 64),
      _contentAvailable: true,
      data: {
        notificationType: "call-ended",
        roomId: value.roomId,
        answered: Array.isArray(value.answeredByIds) && value.answeredByIds.includes(recipientId),
      },
    };
  }
  return null;
}

export async function deliverPushEvent(recipientId: string, name: string, payload: unknown): Promise<void> {
  const content = pushContentForEvent(recipientId, name, payload);
  if (!content) return;
  if (name === "message:created" && await recipientMutedStream(recipientId, payload)) return;
  const devices = await pool.query<{ expo_push_token: string }>("SELECT expo_push_token FROM push_devices WHERE user_id=$1 AND enabled", [recipientId]);
  if (!devices.rowCount) return;
  const messages = devices.rows.map(({ expo_push_token }) => ({ to: expo_push_token, ...content }));
  const response = await fetch(EXPO_PUSH_URL, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(messages),
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`Expo push gateway returned ${response.status}`);
  const result = await response.json() as { data?: Array<{ status?: string; details?: { error?: string } }> };
  const invalidTokens = devices.rows.filter((_device, index) => result.data?.[index]?.details?.error === "DeviceNotRegistered").map((device) => device.expo_push_token);
  if (invalidTokens.length) await pool.query("UPDATE push_devices SET enabled=false WHERE expo_push_token=ANY($1::text[])", [invalidTokens]);
}

async function recipientMutedStream(recipientId: string, payload: unknown): Promise<boolean> {
  if (!payload || typeof payload !== "object") return false;
  const value = payload as Record<string, unknown>;
  if (value.streamKind !== "conversation" || typeof value.streamId !== "string") return false;
  const result = await pool.query<{ muted: boolean }>(
    "SELECT muted_until IS NOT NULL AND muted_until>now() muted FROM conversation_members WHERE user_id=$1 AND conversation_id=$2",
    [recipientId, value.streamId],
  );
  return result.rows[0]?.muted === true;
}

function attachmentLabel(kind: unknown): string {
  if (kind === "voice") return "Голосовое сообщение";
  if (kind === "video-note") return "Видеосообщение";
  if (kind === "media") return "Фото или видео";
  if (kind === "file") return "Файл";
  return "Новое сообщение";
}
