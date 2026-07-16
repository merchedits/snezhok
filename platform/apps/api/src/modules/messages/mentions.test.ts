import assert from "node:assert/strict";
import test from "node:test";
import { extractMentionUsernames } from "./service.js";

test("mention extraction is normalized, unique and boundary aware", () => {
  assert.deepEqual(
    extractMentionUsernames("Hi @Alice, @alice and @bob_snow. email@ignored.com @ab @valid-user"),
    ["alice", "bob_snow", "valid-user"],
  );
});
