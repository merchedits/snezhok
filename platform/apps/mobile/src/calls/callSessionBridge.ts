import type { CallUpdatePayload } from "@snezhok/contracts";

type CallUpdateHandler = (payload: CallUpdatePayload) => void;

let handler: CallUpdateHandler | null = null;
const pending: CallUpdatePayload[] = [];

/**
 * Realtime and notification entry points live outside React. This bridge keeps
 * those transports decoupled from the persistent call provider while still
 * preserving an ended event received during application startup.
 */
export function bindCallUpdateHandler(next: CallUpdateHandler | null): void {
  handler = next;
  if (!next || pending.length === 0) return;
  const queued = pending.splice(0, pending.length);
  for (const payload of queued) next(payload);
}

export function receiveCallUpdate(payload: CallUpdatePayload): void {
  if (handler) {
    handler(payload);
    return;
  }
  if (pending.some((item) => item.roomId === payload.roomId && item.state === payload.state)) return;
  pending.push(payload);
  if (pending.length > 16) pending.shift();
}

export function receiveCallEnded(roomId: string): void {
  receiveCallUpdate({ roomId, state: "ended", participantIds: [], endedAt: Date.now() });
}
