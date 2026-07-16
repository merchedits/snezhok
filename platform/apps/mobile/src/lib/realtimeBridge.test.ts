import assert from "node:assert/strict";
import test from "node:test";

import {
  bindRealtimeSocket,
  currentTypingUsers,
  emitRealtimeTyping,
  joinRealtimeStream,
  leaveRealtimeStream,
  realtimeBridgeInternals,
  receiveRealtimeTyping,
  rejoinRequestedStreams,
  subscribeRealtimeTyping,
  type RealtimeCommandSocket,
} from "./realtimeBridge";

interface Emission { event: string; payload: unknown }

function fakeSocket(emissions: Emission[]): RealtimeCommandSocket {
  return {
    connected: true,
    emit(event: "stream:join" | "stream:leave" | "typing:set", payload: unknown, acknowledge?: (accepted: boolean) => void) {
      emissions.push({ event, payload });
      acknowledge?.(true);
    },
  } as RealtimeCommandSocket;
}

test.afterEach(() => realtimeBridgeInternals.reset());

test("requested chat rooms rejoin once a realtime connection becomes available", () => {
  const emissions: Emission[] = [];
  joinRealtimeStream("chat-a");
  bindRealtimeSocket(fakeSocket(emissions));
  rejoinRequestedStreams();
  emitRealtimeTyping("chat-a", true);
  leaveRealtimeStream("chat-a");
  assert.deepEqual(emissions.map((item) => item.event), ["stream:join", "typing:set", "stream:leave"]);
});

test("typing users expire when a stop event is lost", async () => {
  const snapshots: string[][] = [];
  const unsubscribe = subscribeRealtimeTyping("chat-a", (ids) => snapshots.push([...ids]));
  receiveRealtimeTyping("chat-a", "user-a", true, 15);
  assert.deepEqual(currentTypingUsers("chat-a"), ["user-a"]);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.deepEqual(currentTypingUsers("chat-a"), []);
  assert.deepEqual(snapshots, [[], ["user-a"], []]);
  unsubscribe();
});

test("disconnect clears ephemeral typing state without forgetting requested rooms", () => {
  const emissions: Emission[] = [];
  joinRealtimeStream("chat-a");
  receiveRealtimeTyping("chat-a", "user-a", true);
  bindRealtimeSocket(null);
  assert.deepEqual(currentTypingUsers("chat-a"), []);
  bindRealtimeSocket(fakeSocket(emissions));
  rejoinRequestedStreams();
  assert.equal(emissions[0]?.event, "stream:join");
});
