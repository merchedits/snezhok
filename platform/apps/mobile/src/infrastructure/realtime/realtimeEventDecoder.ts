import { serverEventSchemas, type ServerToClientEvents } from "@snezhok/contracts";

export type ServerEventName = keyof ServerToClientEvents;
export type ServerEventPayload<Name extends ServerEventName> = Parameters<ServerToClientEvents[Name]>[0];

export type RealtimeDecodeResult<Name extends ServerEventName> =
  | { success: true; data: ServerEventPayload<Name> }
  | { success: false; issueCount: number };

export function decodeRealtimeEvent<Name extends ServerEventName>(name: Name, payload: unknown): RealtimeDecodeResult<Name> {
  const result = serverEventSchemas[name].safeParse(payload);
  if (!result.success) return { success: false, issueCount: result.error.issues.length };
  return { success: true, data: result.data as ServerEventPayload<Name> };
}
