import { serverEventSchemas, type ServerToClientEvents } from "@snezhok/contracts";

import { decodeMessageValue } from "../../domains/messaging/messageDecoding";

export type ServerEventName = keyof ServerToClientEvents;
export type ServerEventPayload<Name extends ServerEventName> = Parameters<ServerToClientEvents[Name]>[0];

export type RealtimeDecodeResult<Name extends ServerEventName> =
  | { success: true; data: ServerEventPayload<Name> }
  | { success: false; issueCount: number };

export function decodeRealtimeEvent<Name extends ServerEventName>(name: Name, payload: unknown): RealtimeDecodeResult<Name> {
  if (name === "message:created" || name === "message:updated") {
    const decoded = decodeMessageValue(payload);
    return decoded.message
      ? { success: true, data: decoded.message as ServerEventPayload<Name> }
      : { success: false, issueCount: 1 };
  }
  if (name === "sync:event" && record(payload)) {
    const eventName = payload.name;
    if ((eventName === "message:created" || eventName === "message:updated") && positiveInteger(payload.cursor)) {
      const decoded = decodeMessageValue(payload.payload);
      return decoded.message
        ? { success: true, data: { cursor: payload.cursor, name: eventName, payload: decoded.message } as ServerEventPayload<Name> }
        : { success: false, issueCount: 1 };
    }
  }
  const result = serverEventSchemas[name].safeParse(payload);
  if (!result.success) return { success: false, issueCount: result.error.issues.length };
  return { success: true, data: result.data as ServerEventPayload<Name> };
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function positiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}
