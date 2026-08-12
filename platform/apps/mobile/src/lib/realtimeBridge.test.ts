import assert from "node:assert/strict";
import test from "node:test";

import {
  bindRealtimeSocket,
  currentTypingUsers,
  emitRealtimeDrawing,
  emitRealtimeTyping,
  joinRealtimeStream,
  leaveRealtimeStream,
  realtimeBridgeInternals,
  receiveRealtimeTyping,
  receiveRealtimeDrawing,
  rejoinRequestedStreams,
  subscribeRealtimeTyping,
  subscribeRealtimeDrawing,
  type RealtimeCommandSocket,
} from "./realtimeBridge";

interface Emission { event: string; payload: unknown }

function fakeSocket(emissions: Emission[]): RealtimeCommandSocket {
  return {
    connected: true,
    emit(event: "stream:join" | "stream:leave" | "typing:set" | "activity:drawing:set", payload: unknown, acknowledge?: (accepted: boolean) => void) {
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

test("disconnect clears non-durable drawing previews", () => {
  const snapshots: number[][][][] = [];
  const unsubscribe = subscribeRealtimeDrawing("activity-a", (strokes) => snapshots.push(strokes));
  receiveRealtimeDrawing("activity-a", 1, [[[0, 0], [1, 1]]]);
  bindRealtimeSocket(null);
  assert.deepEqual(snapshots.at(-1), []);
  unsubscribe();
});

test("drawing snapshots are throttled for transport and ordered for viewers", async () => {
  const emissions: Emission[] = [];
  const snapshots: number[][][][] = [];
  joinRealtimeStream("chat-a");
  bindRealtimeSocket(fakeSocket(emissions));
  emitRealtimeDrawing("chat-a", "activity-a", [[[0, 0], [1, 1]]]);
  emitRealtimeDrawing("chat-a", "activity-a", [[[0, 0], [2, 2]]]);
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(emissions.filter((item) => item.event === "activity:drawing:set").length, 1);
  assert.deepEqual((emissions.at(-1)?.payload as { strokes: number[][][] }).strokes, [[[0, 0], [2, 2]]]);

  const unsubscribe = subscribeRealtimeDrawing("activity-a", (strokes) => snapshots.push(strokes));
  receiveRealtimeDrawing("activity-a", 2, [[[0, 0], [4, 4]]]);
  receiveRealtimeDrawing("activity-a", 1, [[[0, 0], [3, 3]]]);
  assert.deepEqual(snapshots.at(-1), [[[0, 0], [4, 4]]]);
  unsubscribe();
});
