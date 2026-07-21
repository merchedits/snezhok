import assert from "node:assert/strict";
import test from "node:test";

import { LiveKitCallMediaPlane, isLiveKitAlreadyExists, isLiveKitNotFound, type LiveKitRoomControl } from "./mediaPlane.js";

test("room termination revokes every connected identity before deleting the room", async () => {
  const operations: string[] = [];
  const rooms: LiveKitRoomControl = {
    async createRoom() {},
    async listParticipants(room) { operations.push(`list:${room}`); return [{ identity: "a" }, { identity: "b" }]; },
    async removeParticipant(room, identity, options) { operations.push(`remove:${room}:${identity}:${options.revokeTokenTs}`); },
    async deleteRoom(room) { operations.push(`delete:${room}`); },
  };
  await new LiveKitCallMediaPlane(rooms).terminateRoom("room-1", 123n);
  assert.deepEqual(operations, ["list:room-1", "remove:room-1:a:123", "remove:room-1:b:123", "delete:room-1"]);
});

test("already absent rooms and participants make control commands idempotent", async () => {
  const missing = Object.assign(new Error("redacted"), { code: "not_found" });
  const rooms: LiveKitRoomControl = {
    async createRoom() { throw Object.assign(new Error("exists"), { code: "already_exists" }); },
    async listParticipants() { throw missing; },
    async removeParticipant() { throw missing; },
    async deleteRoom() { throw new Error("must not be called"); },
  };
  const plane = new LiveKitCallMediaPlane(rooms);
  await plane.ensureRoom("existing");
  await plane.terminateRoom("absent", 1n);
  await plane.removeParticipant("absent", "user", 1n);
  assert.equal(isLiveKitNotFound({ status: 404 }), true);
  assert.equal(isLiveKitNotFound(new Error("not found")), false);
  assert.equal(isLiveKitAlreadyExists({ statusCode: 409 }), true);
});

test("unexpected control-plane failures are retained for durable retry", async () => {
  const rooms: LiveKitRoomControl = {
    async createRoom() {},
    async listParticipants() { throw Object.assign(new Error("unavailable"), { code: "unavailable" }); },
    async removeParticipant() {},
    async deleteRoom() {},
  };
  await assert.rejects(new LiveKitCallMediaPlane(rooms).terminateRoom("room", 1n), /unavailable/);
});

test("rooms are explicitly created because client tokens cannot auto-create them", async () => {
  const options: Array<{ name: string; emptyTimeout: number; departureTimeout: number }> = [];
  const rooms: LiveKitRoomControl = {
    async createRoom(value) { options.push(value); },
    async listParticipants() { return []; },
    async removeParticipant() {},
    async deleteRoom() {},
  };
  await new LiveKitCallMediaPlane(rooms).ensureRoom("controlled-room");
  assert.deepEqual(options, [{ name: "controlled-room", emptyTimeout: 120, departureTimeout: 20 }]);
});
