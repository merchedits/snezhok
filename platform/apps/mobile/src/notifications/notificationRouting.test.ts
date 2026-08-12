import assert from "node:assert/strict";
import test from "node:test";

import { extractNotificationTaskData, notificationTargetFromData } from "./notificationRouting";

const defaultAction = "default";
const call = { notificationType: "call", roomId: "call-1", streamId: "stream-1", streamKind: "conversation", title: "Anna", startedAt: 100_000 };

test("incoming notification joins only the exact recent call", () => {
  assert.deepEqual(notificationTargetFromData(call, "answer-video", defaultAction, false, 150_000), {
    type: "call", streamId: "stream-1", title: "Anna", startWithVideo: true, expectedCallId: "call-1",
  });
  assert.equal(notificationTargetFromData(call, defaultAction, defaultAction, false, 200_001), null);
  assert.equal(notificationTargetFromData({ ...call, startedAt: undefined }, defaultAction, defaultAction, false, 150_000), null);
});

test("hidden server destinations stay hidden and message taps remain actionable", () => {
  const message = { notificationType: "message", streamId: "stream-1", streamKind: "channel", title: "Server" };
  assert.equal(notificationTargetFromData(message, defaultAction, defaultAction, false), null);
  assert.deepEqual(notificationTargetFromData({ ...message, streamKind: "conversation" }, "default", defaultAction, false), {
    type: "message", streamId: "stream-1", streamKind: "conversation", title: "Server",
  });
});

test("background task data is normalized without throwing on corrupt JSON", () => {
  assert.deepEqual(extractNotificationTaskData({ dataString: JSON.stringify({ data: { notificationType: "call-ended", roomId: "call-1" } }) }), { notificationType: "call-ended", roomId: "call-1" });
  assert.equal(extractNotificationTaskData({ dataString: "{" }), null);
});
