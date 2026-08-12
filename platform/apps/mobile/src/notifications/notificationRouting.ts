export const CALL_NOTIFICATION_LIFETIME_MS = 90_000;

export type NotificationTarget =
  | { type: "message"; streamId: string; streamKind: "conversation" | "channel"; title: string }
  | { type: "call"; streamId: string; title: string; startWithVideo: boolean; expectedCallId: string };

/**
 * Converts untrusted notification data into a safe navigation target.
 *
 * Incoming-call notifications are deliberately bound to the exact server call
 * and expire locally as well as at the push provider. Without both checks, a
 * delayed tap could accidentally create or join a newer call in the same chat.
 */
export function notificationTargetFromData(
  data: Record<string, unknown> | undefined,
  actionIdentifier: string,
  _defaultActionIdentifier: string,
  serversEnabled: boolean,
  now = Date.now(),
): NotificationTarget | null {
  if (!data || (data.streamKind === "channel" && !serversEnabled)) return null;
  if (
    data.notificationType === "call"
    && typeof data.roomId === "string"
    && typeof data.streamId === "string"
    && typeof data.title === "string"
    && typeof data.startedAt === "number"
    && Number.isFinite(data.startedAt)
    && data.startedAt <= now + 5_000
    && now - data.startedAt <= CALL_NOTIFICATION_LIFETIME_MS
  ) {
    return {
      type: "call",
      streamId: data.streamId,
      title: data.title,
      startWithVideo: actionIdentifier === "answer-video",
      expectedCallId: data.roomId,
    };
  }
  if (
    data.notificationType === "message"
    && typeof data.streamId === "string"
    && (data.streamKind === "conversation" || (data.streamKind === "channel" && serversEnabled))
    && typeof data.title === "string"
  ) {
    return { type: "message", streamId: data.streamId, streamKind: data.streamKind, title: data.title };
  }
  return null;
}

/** Normalizes Expo's foreground, headless and action-response task shapes. */
export function extractNotificationTaskData(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.dataString === "string") {
    try {
      return extractNotificationTaskData(JSON.parse(record.dataString) as unknown);
    } catch {
      return null;
    }
  }
  if (typeof record.notificationType === "string") return record;
  if (record.data) return extractNotificationTaskData(record.data);
  return null;
}
