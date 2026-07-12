import type { ChannelSummary, ConversationSummary, FriendEntry, Id, Message, Presence, ServerSummary, Timestamp } from "./models.js";

export interface ServerToClientEvents {
  "sync:ready": (payload: { cursor: number; serverTime: Timestamp }) => void;
  "message:created": (message: Message) => void;
  "message:updated": (message: Message) => void;
  "message:deleted": (payload: { id: Id; streamId: Id; deletedAt: Timestamp }) => void;
  "conversation:updated": (conversation: ConversationSummary) => void;
  "conversation:removed": (payload: { id: Id }) => void;
  "server:updated": (server: ServerSummary) => void;
  "server:removed": (payload: { id: Id }) => void;
  "membership:updated": (payload: { serverId: Id; userId: Id; state: "joined" | "updated" | "removed" }) => void;
  "channel:updated": (channel: ChannelSummary) => void;
  "friend:updated": (entry: FriendEntry) => void;
  "friend:removed": (payload: { userId: Id }) => void;
  "presence:updated": (payload: { userId: Id; presence: Presence; lastSeenAt: Timestamp }) => void;
  "typing:updated": (payload: { streamId: Id; userId: Id; typing: boolean }) => void;
  "read:updated": (payload: { streamId: Id; userId: Id; sequence: number }) => void;
  "call:updated": (payload: { roomId: Id; state: "started" | "ended"; participantIds: Id[] }) => void;
}

export interface ClientToServerEvents {
  "sync:resume": (payload: { cursor: number }, acknowledge: (accepted: boolean) => void) => void;
  "stream:join": (payload: { streamId: Id }, acknowledge: (accepted: boolean) => void) => void;
  "stream:leave": (payload: { streamId: Id }) => void;
  "typing:set": (payload: { streamId: Id; typing: boolean }) => void;
  "read:set": (payload: { streamId: Id; sequence: number }) => void;
}
