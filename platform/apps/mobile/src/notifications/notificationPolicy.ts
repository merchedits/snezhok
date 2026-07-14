import type { Message } from "@snezhok/contracts";

const RECENT_EVENT_WINDOW_MS = 60_000;

export function shouldNotifyMessage(message: Message, currentUserId: string | undefined, now = Date.now()): boolean {
  if (!currentUserId || message.sender.id === currentUserId || message.deletedAt) return false;
  return message.createdAt <= now + 5_000 && now - message.createdAt <= RECENT_EVENT_WINDOW_MS;
}

export function shouldNotifyCall(
  payload: { state: "started" | "ended"; callerId?: string; startedAt?: number; streamId?: string },
  currentUserId: string | undefined,
  now = Date.now(),
): boolean {
  if (payload.state !== "started" || !payload.streamId || !currentUserId || payload.callerId === currentUserId || !payload.startedAt) return false;
  return payload.startedAt <= now + 5_000 && now - payload.startedAt <= RECENT_EVENT_WINDOW_MS;
}
