import assert from "node:assert/strict";
import test from "node:test";
import { profilePhotoOrderSchema, profileUpdateSchema } from "@snezhok/contracts";
import { samePhotoSet } from "./routes.js";

test("profile updates accept concise owner-controlled fields", () => {
  assert.deepEqual(profileUpdateSchema.parse({ displayName: " Snow ", bio: " Hello ", statusText: " Available " }), {
    displayName: "Snow", bio: "Hello", statusText: "Available",
  });
  assert.throws(() => profileUpdateSchema.parse({}));
});

test("photo ordering is complete, stable and duplicate-free", () => {
  const first = "00000000-0000-4000-8000-000000000001";
  const second = "00000000-0000-4000-8000-000000000002";
  assert.deepEqual(profilePhotoOrderSchema.parse({ attachmentIds: [second, first] }).attachmentIds, [second, first]);
  assert.equal(samePhotoSet([first, second], [second, first]), true);
  assert.equal(samePhotoSet([first, second], [first]), false);
  assert.throws(() => profilePhotoOrderSchema.parse({ attachmentIds: [first, first] }));
});
