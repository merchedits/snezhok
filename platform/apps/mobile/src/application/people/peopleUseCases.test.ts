import assert from "node:assert/strict";
import test from "node:test";
import type { ConversationSummary, UserSummary } from "@snezhok/contracts";
import { createPeopleUseCases, type PeopleGateway } from "./peopleUseCasesCore";

function gateway(overrides: Partial<PeopleGateway> = {}): PeopleGateway {
  const unavailable = () => Promise.reject(new Error("unused"));
  return {
    searchUsers: unavailable, createConversation: unavailable, createGroup: unavailable,
    requestFriend: unavailable, respondFriend: unavailable, cancelFriendRequest: unavailable,
    removeFriend: unavailable, blockUser: unavailable, unblockUser: unavailable, ...overrides,
  };
}

test("opening an existing direct chat does not issue a duplicate mutation", async () => {
  const existing = { id: "stream", kind: "direct", participants: [{ id: "peer" }] } as ConversationSummary;
  let creates = 0;
  const useCases = createPeopleUseCases(gateway({ createConversation: async () => { creates += 1; return existing; } }));
  assert.deepEqual(await useCases.openDirect([existing], "peer"), { conversation: existing, created: false });
  assert.equal(creates, 0);
});

test("people mutations normalize user input at the application boundary", async () => {
  const observed = { search: "", username: "", participants: [] as string[], title: "" };
  const useCases = createPeopleUseCases(gateway({
    searchUsers: async (query) => { observed.search = query; return []; },
    requestFriend: async (username) => { observed.username = username; return {} as never; },
    createGroup: async (participants, title) => { observed.participants = participants; observed.title = title; return {} as never; },
  }));
  await useCases.search("  snow  ");
  await useCases.requestFriend(" @friend ");
  await useCases.createGroup([{ id: "a" }, { id: "b" }] as UserSummary[], "  Group  ");
  assert.deepEqual(observed, { search: "snow", username: "friend", participants: ["a", "b"], title: "Group" });
});
