import { RoomServiceClient } from "livekit-server-sdk";

import { config } from "../../config.js";

export interface CallMediaPlane {
  ensureRoom(roomName: string): Promise<void>;
  terminateRoom(roomName: string, revokeTokenTs: bigint): Promise<void>;
  removeParticipant(roomName: string, identity: string, revokeTokenTs: bigint): Promise<void>;
}

export interface LiveKitRoomControl {
  createRoom(options: { name: string; emptyTimeout: number; departureTimeout: number }): Promise<unknown>;
  listParticipants(roomName: string): Promise<Array<{ identity: string }>>;
  removeParticipant(roomName: string, identity: string, options: { revokeTokenTs: bigint }): Promise<void>;
  deleteRoom(roomName: string): Promise<void>;
}

export class LiveKitCallMediaPlane implements CallMediaPlane {
  constructor(private readonly rooms: LiveKitRoomControl) {}

  async ensureRoom(roomName: string): Promise<void> {
    try {
      await this.rooms.createRoom({
        name: roomName,
        emptyTimeout: config.CALL_PHANTOM_TIMEOUT_SECONDS,
        departureTimeout: 20,
      });
    } catch (error) {
      if (!isLiveKitAlreadyExists(error)) throw error;
    }
  }

  async terminateRoom(roomName: string, revokeTokenTs: bigint): Promise<void> {
    let participants: Array<{ identity: string }> = [];
    try {
      participants = await this.rooms.listParticipants(roomName);
    } catch (error) {
      if (!isLiveKitNotFound(error)) throw error;
      return;
    }
    for (const participant of participants) {
      try {
        await this.rooms.removeParticipant(roomName, participant.identity, { revokeTokenTs });
      } catch (error) {
        if (!isLiveKitNotFound(error)) throw error;
      }
    }
    try {
      await this.rooms.deleteRoom(roomName);
    } catch (error) {
      if (!isLiveKitNotFound(error)) throw error;
    }
  }

  async removeParticipant(roomName: string, identity: string, revokeTokenTs: bigint): Promise<void> {
    try {
      await this.rooms.removeParticipant(roomName, identity, { revokeTokenTs });
    } catch (error) {
      if (!isLiveKitNotFound(error)) throw error;
    }
  }
}

export function isLiveKitNotFound(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const value = error as { code?: unknown; status?: unknown; statusCode?: unknown };
  return value.code === "not_found" || value.code === 5 || value.status === 404 || value.statusCode === 404;
}

export function isLiveKitAlreadyExists(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const value = error as { code?: unknown; status?: unknown; statusCode?: unknown };
  return value.code === "already_exists" || value.code === 6 || value.status === 409 || value.statusCode === 409;
}

let mediaPlane: CallMediaPlane | null = null;

export function getCallMediaPlane(): CallMediaPlane {
  mediaPlane ??= new LiveKitCallMediaPlane(new RoomServiceClient(
    config.LIVEKIT_CONTROL_URL,
    config.LIVEKIT_API_KEY,
    config.LIVEKIT_API_SECRET,
    { requestTimeout: 2_500 },
  ));
  return mediaPlane;
}

export function setCallMediaPlaneForTests(replacement: CallMediaPlane | null): void {
  mediaPlane = replacement;
}
