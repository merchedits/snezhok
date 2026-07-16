import { pool } from "../../db/pool.js";
import type { DbClient } from "../../db/pool.js";

export const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
export const EXPO_RECEIPTS_URL = "https://exp.host/--/api/v2/push/getReceipts";

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

export interface ExpoReceipt {
  status?: "ok" | "error";
  message?: string;
  details?: { error?: string };
}

export class PushGatewayError extends Error {
  constructor(message: string, readonly retryable: boolean, readonly code?: string) {
    super(message);
    this.name = "PushGatewayError";
  }
}

export interface NotificationRenderOptions {
  language: "en" | "ru";
  showPreview: boolean;
}

const defaultRenderOptions: NotificationRenderOptions = { language: "ru", showPreview: true };

export function pushContentForEvent(
  recipientId: string,
  name: string,
  payload: unknown,
  options: NotificationRenderOptions = defaultRenderOptions,
): Omit<ExpoPushMessage, "to"> | null {
  if (!payload || typeof payload !== "object") return null;
  const value = payload as Record<string, unknown>;
  if (name === "message:created") {
    if (value.silent === true) return null;
    const sender = value.sender && typeof value.sender === "object" ? value.sender as Record<string, unknown> : null;
    if (!sender || sender.id === recipientId || typeof value.streamId !== "string") return null;
    const senderName = typeof sender.displayName === "string" ? sender.displayName : "Snezhok";
    const text = options.showPreview
      ? (typeof value.text === "string" && value.text.trim() ? value.text.trim() : attachmentLabel(value.kind, options.language))
      : localized(options.language).newMessage;
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
    const copy = localized(options.language);
    return {
      title: `${copy.incomingCall} · ${caller}`,
      body: copy.tapToAnswer,
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

/** Builds the exact provider payload once, before durable per-device fanout. */
export async function pushMessageForEvent(recipientId: string, name: string, payload: unknown): Promise<Omit<ExpoPushMessage, "to"> | null> {
  const policy = await notificationPolicyForEvent(recipientId, name, payload);
  if (!policy.enabled) return null;
  return pushContentForEvent(recipientId, name, payload, { language: policy.language, showPreview: policy.showPreview });
}

export async function sendExpoPush(
  token: string,
  message: Omit<ExpoPushMessage, "to">,
  fetchImplementation: typeof fetch = fetch,
): Promise<string | null> {
  const response = await fetchImplementation(EXPO_PUSH_URL, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ to: token, ...message }),
    signal: AbortSignal.timeout(8_000),
  }).catch((error: unknown) => {
    throw new PushGatewayError(error instanceof Error ? error.message : "Expo push gateway request failed", true);
  });
  if (!response.ok) {
    throw new PushGatewayError(`Expo push gateway returned ${response.status}`, response.status === 429 || response.status >= 500, `HTTP_${response.status}`);
  }
  const result = await response.json() as { data?: { status?: string; id?: string; message?: string; details?: { error?: string } } };
  const ticket = result.data;
  if (ticket?.status === "ok") return typeof ticket.id === "string" ? ticket.id : null;
  const code = ticket?.details?.error;
  throw new PushGatewayError(ticket?.message ?? code ?? "Expo rejected the push notification", isRetryableExpoError(code), code);
}

export async function fetchExpoReceipts(ticketIds: string[], fetchImplementation: typeof fetch = fetch): Promise<Record<string, ExpoReceipt>> {
  if (!ticketIds.length) return {};
  const response = await fetchImplementation(EXPO_RECEIPTS_URL, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ ids: ticketIds }),
    signal: AbortSignal.timeout(8_000),
  }).catch((error: unknown) => {
    throw new PushGatewayError(error instanceof Error ? error.message : "Expo receipt request failed", true);
  });
  if (!response.ok) throw new PushGatewayError(`Expo receipt gateway returned ${response.status}`, response.status === 429 || response.status >= 500, `HTTP_${response.status}`);
  const result = await response.json() as { data?: Record<string, ExpoReceipt> };
  return result.data ?? {};
}

export function isRetryableExpoError(code: string | undefined): boolean {
  return code === "MessageRateExceeded" || code === "ExpoServerError" || code === undefined;
}

export async function notificationPolicyForEvent(
  recipientId: string,
  name: string,
  payload: unknown,
  client: Pick<DbClient, "query"> = pool,
): Promise<{ enabled: boolean; language: "en" | "ru"; showPreview: boolean }> {
  const settingsResult = await client.query<{ settings: Record<string, unknown> }>("SELECT settings FROM user_settings WHERE user_id=$1", [recipientId]);
  const settings = settingsResult.rows[0]?.settings ?? {};
  const language = settings.language === "en" ? "en" : "ru";
  const globallyEnabled = name === "message:created"
    ? settings.messageNotifications !== false
    : name === "call:updated"
      ? settings.callNotifications !== false
      : true;
  let showPreview = settings.notificationPreviews !== false;
  // Ended-call pushes dismiss a previously displayed incoming-call surface and
  // must not be suppressed by a mute that was changed while the call rang.
  const value = payload && typeof payload === "object" ? payload as Record<string, unknown> : null;
  if (name === "call:updated" && value?.state === "ended") return { enabled: true, language, showPreview: false };
  if (!globallyEnabled || !value) return { enabled: globallyEnabled, language, showPreview };
  if ((value.streamKind !== "conversation" && value.streamKind !== "channel") || typeof value.streamId !== "string") {
    return { enabled: globallyEnabled, language, showPreview };
  }
  const result = await client.query<{ enabled: boolean | null; show_preview: boolean | null; override_muted: boolean; membership_muted: boolean }>(
    `SELECT policy.enabled,policy.show_preview,
       coalesce(policy.muted_until>now(),false) override_muted,
       CASE WHEN $2='conversation' THEN coalesce((
         SELECT member.muted_until>now() FROM conversation_members member
         WHERE member.user_id=$1 AND member.conversation_id=$3
       ),false)
       ELSE coalesce((
         SELECT member.muted_until>now() FROM channels channel
         JOIN server_members member ON member.server_id=channel.server_id AND member.user_id=$1
         WHERE channel.id=$3
       ),false) END membership_muted
     FROM (SELECT 1) singleton
     LEFT JOIN stream_notification_settings policy
       ON policy.user_id=$1 AND policy.stream_kind=$2 AND policy.stream_id=$3`,
    [recipientId, value.streamKind, value.streamId],
  );
  const row = result.rows[0];
  if (row?.show_preview !== null && row?.show_preview !== undefined) showPreview = row.show_preview;
  return {
    enabled: globallyEnabled && row?.enabled !== false && row?.override_muted !== true && row?.membership_muted !== true,
    language,
    showPreview,
  };
}

function attachmentLabel(kind: unknown, language: "en" | "ru"): string {
  const copy = localized(language);
  if (kind === "voice") return copy.voice;
  if (kind === "video-note") return copy.videoNote;
  if (kind === "media") return copy.media;
  if (kind === "file") return copy.file;
  return copy.newMessage;
}

function localized(language: "en" | "ru") {
  return language === "en" ? {
    newMessage: "New message",
    voice: "Voice message",
    videoNote: "Video message",
    media: "Photo or video",
    file: "File",
    incomingCall: "Incoming call",
    tapToAnswer: "Tap to answer",
  } : {
    newMessage: "Новое сообщение",
    voice: "Голосовое сообщение",
    videoNote: "Видеосообщение",
    media: "Фото или видео",
    file: "Файл",
    incomingCall: "Входящий звонок",
    tapToAnswer: "Нажмите, чтобы ответить",
  };
}
