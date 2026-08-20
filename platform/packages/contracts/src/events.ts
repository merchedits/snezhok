import type { AttachmentLifecycleUpdate, ChannelCategory, ChannelSummary, ConversationSummary, FriendEntry, Id, Message, Presence, ServerRoleDefinition, ServerSummary, Timestamp } from "./models.js";

export type CallEndReason =
  | "ended-by-user"
  | "declined"
  | "room-finished"
  | "stale-timeout"
  | "no-participant-timeout"
  | "permission-changed"
  | "account-suspended"
  | "account-deleted"
  | "user-blocked"
  | "member-left"
  | "member-kicked"
  | "member-banned"
  | "channel-deleted";

export interface CallUpdatePayload {
  roomId: Id;
  state: "started" | "ended";
  participantIds: Id[];
  /** Present on events emitted by servers that support incoming-call notifications. */
  streamId?: Id;
  streamKind?: "conversation" | "channel";
  title?: string;
  callerId?: Id;
  callerName?: string;
  startedAt?: Timestamp;
  endedAt?: Timestamp;
  answeredByIds?: Id[];
  reason?: CallEndReason;
}

export interface DurableServerEvents {
  "message:created": (message: Message) => void;
  "message:updated": (message: Message) => void;
  "message:deleted": (payload: { id: Id; streamId: Id; deletedAt: Timestamp }) => void;
  "attachment:updated": (payload: AttachmentLifecycleUpdate) => void;
  "conversation:updated": (conversation: ConversationSummary) => void;
  "conversation:removed": (payload: { id: Id }) => void;
  "server:updated": (server: ServerSummary) => void;
  "server:removed": (payload: { id: Id }) => void;
  "membership:updated": (payload: { serverId: Id; userId: Id; state: "joined" | "updated" | "removed" }) => void;
  "channel:updated": (channel: ChannelSummary) => void;
  "channel:removed": (payload: { id: Id; serverId: Id }) => void;
  "category:updated": (category: ChannelCategory) => void;
  "category:removed": (payload: { id: Id; serverId: Id }) => void;
  "server-role:updated": (role: ServerRoleDefinition) => void;
  "server-role:removed": (payload: { id: Id; serverId: Id }) => void;
  "friend:updated": (entry: FriendEntry) => void;
  "friend:removed": (payload: { userId: Id }) => void;
  /** Usually ephemeral, but persisted when an authorization change hides a peer. */
  "presence:updated": (payload: { userId: Id; presence: Presence; lastSeenAt: Timestamp }) => void;
  "user:deleted": (payload: { id: Id }) => void;
  "read:updated": (payload: { streamId: Id; userId: Id; sequence: number; markedUnread?: boolean }) => void;
  "call:updated": (payload: CallUpdatePayload) => void;
}

export type DurableEventName = keyof DurableServerEvents;
export type DurableEventEnvelope = {
  [Name in DurableEventName]: {
    cursor: number;
    name: Name;
    payload: Parameters<DurableServerEvents[Name]>[0];
  }
}[DurableEventName];

export interface ServerToClientEvents extends DurableServerEvents {
  /** Atomic cursor + payload delivery used by architecture-v2 clients. */
  "sync:event": (event: DurableEventEnvelope) => void;
  /** Legacy replay checkpoint retained for already-installed 4.x clients. */
  "sync:ready": (payload: { cursor: number; serverTime: Timestamp }) => void;
  "presence:updated": (payload: { userId: Id; presence: Presence; lastSeenAt: Timestamp }) => void;
  "typing:updated": (payload: { streamId: Id; userId: Id; typing: boolean }) => void;
  "activity:drawing:updated": (payload: { streamId: Id; activityId: Id; userId: Id; sequence: number; strokes: number[][][] }) => void;
}

export interface ClientToServerEvents {
  "sync:resume": (payload: { cursor: number }, acknowledge: (accepted: boolean) => void) => void;
  "stream:join": (payload: { streamId: Id }, acknowledge: (accepted: boolean) => void) => void;
  "stream:leave": (payload: { streamId: Id }) => void;
  "typing:set": (payload: { streamId: Id; typing: boolean }) => void;
  "activity:drawing:set": (payload: { streamId: Id; activityId: Id; sequence: number; strokes: number[][][] }) => void;
  "read:set": (payload: { streamId: Id; sequence: number }) => void;
}
