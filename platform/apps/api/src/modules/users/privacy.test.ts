import assert from "node:assert/strict";
import test from "node:test";
import { audienceAllows } from "./privacy.js";
import { mapContactUser, mapUser, type PublicUserRow } from "./queries.js";

test("privacy audiences are fail-closed for contacts and nobody", () => {
  assert.equal(audienceAllows("everyone", false), true);
  assert.equal(audienceAllows("contacts", true), true);
  assert.equal(audienceAllows("contacts", false), false);
  assert.equal(audienceAllows("nobody", true), false);
});

test("exact last seen is exposed only through the contact mapping", () => {
  const row = {
    id: "10000000-0000-4000-8000-000000000001", username: "friend", display_name: "Friend",
    avatar_attachment_id: null, avatar_url: null, avatar_color: "#000", bio: "", status_text: "",
    last_seen_at_ms: 123456, show_last_seen: true,
  } satisfies PublicUserRow;
  assert.equal(mapUser(row).lastSeenAt, 0);
  assert.equal(mapContactUser(row).lastSeenAt, 123456);
  assert.equal(mapContactUser({ ...row, show_last_seen: false }).lastSeenAt, 0);
});
