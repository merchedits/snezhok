import assert from "node:assert/strict";
import test from "node:test";

import type { UploadInput } from "../types";
import { pendingUploadMatches, type PendingUpload } from "./pendingUpload";

const input: UploadInput = {
  uri: "file:///photo.jpg",
  filename: "photo.jpg",
  mimeType: "image/jpeg",
  kind: "image",
  quality: "auto",
};
const pending: PendingUpload = {
  ownerId: "account-a",
  uploadId: "upload",
  uri: input.uri,
  filename: input.filename,
  bytes: 100,
  chunkBytes: 64,
  expiresAt: 100_000,
};

test("pending uploads can only resume for the account that created them", () => {
  assert.equal(pendingUploadMatches(pending, input, 100, "account-a", 1), true);
  assert.equal(pendingUploadMatches(pending, input, 100, "account-b", 1), false);
});

test("pending uploads reject changed and nearly expired sources", () => {
  assert.equal(pendingUploadMatches(pending, input, 101, "account-a", 1), false);
  assert.equal(pendingUploadMatches(pending, { ...input, uri: "file:///other.jpg" }, 100, "account-a", 1), false);
  assert.equal(pendingUploadMatches(pending, input, 100, "account-a", 70_000), false);
});
