import assert from "node:assert/strict";
import test from "node:test";

import type { UserSummary } from "@snezhok/contracts";

import { activeMentionQuery, insertMention, mentionSuggestions } from "./mentionAutocomplete";

const user = (id: string, username: string, displayName: string): UserSummary => ({
  id,
  username,
  displayName,
  bio: "",
  statusText: "",
  avatarUrl: null,
  avatarColor: "#fff",
  presence: "offline",
  lastSeenAt: 0,
});

test("detects a mention only at a token boundary before the caret", () => {
  assert.deepEqual(activeMentionQuery("hello @sne", 10), { start: 6, end: 10, query: "sne" });
  assert.deepEqual(activeMentionQuery("@", 1), { start: 0, end: 1, query: "" });
  assert.equal(activeMentionQuery("mail@example.com"), null);
  assert.equal(activeMentionQuery("@done next"), null);
});

test("ranks username prefixes, removes duplicates and excludes the sender", () => {
  const people = [user("me", "snow", "Me"), user("2", "snezhik", "Anna"), user("2", "snezhik", "Anna"), user("3", "anna", "Snezhana")];
  assert.deepEqual(mentionSuggestions(people, "sne", "me").map((item) => item.id), ["2", "3"]);
});

test("replaces the active token and returns the new caret", () => {
  assert.deepEqual(insertMention("Hi @sn, welcome", { start: 3, end: 6, query: "sn" }, "snezhik"), {
    text: "Hi @snezhik, welcome",
    caret: 11,
  });
});
