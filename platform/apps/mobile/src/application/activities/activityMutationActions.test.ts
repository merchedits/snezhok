import assert from "node:assert/strict";
import test from "node:test";

import type { Message } from "@snezhok/contracts";

import { ApiError } from "../../lib/apiError";
import { defaultRuntimeCapabilities, type AppState } from "../../store/appState";
import {
  createActivityMutationActions,
  type ActivityMutationDependencies,
} from "./activityMutationActions";

test("ambiguous create retries with the same idempotency key", async () => {
  const clientIds: string[] = [];
  let calls = 0;
  const transport = transportFixture();
  transport.createActivity = async (_conversationId, _type, _options, clientId) => {
    clientIds.push(clientId ?? "");
    calls += 1;
    if (calls === 1) throw new Error("connection reset after write");
    return activityMessage(1);
  };
  const fixture = createFixture(transport);

  await fixture.actions.createActivity("chat", "question", {});

  assert.deepEqual(clientIds, ["operation-1", "operation-1"]);
  assert.equal(fixture.applied.length, 1);
});

test("revision conflict refreshes state once while preserving the command idempotency key", async () => {
  const revisions: number[] = [];
  const clientIds: string[] = [];
  let calls = 0;
  const transport = transportFixture();
  transport.commandActivity = async (_activityId, revision, _action, _payload, clientId) => {
    revisions.push(revision);
    clientIds.push(clientId ?? "");
    calls += 1;
    if (calls === 1) throw new ApiError("Activity changed", 409, "CONFLICT");
    return activityMessage(5);
  };
  transport.activity = async () => ({ ...activityMessage(4).activity! });
  const fixture = createFixture(transport);

  await fixture.actions.commandActivity(activityMessage(2), "answer", { choice: "yes" });

  assert.deepEqual(revisions, [2, 4]);
  assert.deepEqual(clientIds, ["operation-1", "operation-1"]);
  assert.equal(fixture.applied[0]?.activity?.revision, 5);
});

function createFixture(transport: ActivityMutationDependencies["transport"]) {
  const applied: Message[] = [];
  let id = 0;
  const state = {
    online: true,
    capabilities: { ...defaultRuntimeCapabilities, activities: true },
    applyMessage: (message: Message) => { applied.push(message); },
  } as unknown as AppState;
  const actions = createActivityMutationActions({
    get: () => state,
    createId: () => `operation-${++id}`,
    transport,
  });
  return { actions, applied };
}

function transportFixture(): ActivityMutationDependencies["transport"] {
  return {
    createActivity: async () => activityMessage(1),
    commandActivity: async () => activityMessage(2),
    activity: async () => ({ ...activityMessage(2).activity! }),
  };
}

function activityMessage(revision: number): Message {
  return {
    id: "message", streamId: "chat", streamKind: "conversation", sequence: 1, revision,
    sender: { id: "me", username: "me", displayName: "Me", avatarUrl: null, avatarColor: "#000", presence: "online", lastSeenAt: 1 },
    kind: "activity", text: "", replyTo: null, attachments: [], reactions: [], createdAt: 1, editedAt: null,
    deletedAt: null, pinnedAt: null, activity: { id: "activity", type: "question", revision },
  } as unknown as Message;
}
