import assert from "node:assert/strict";
import test from "node:test";

import {
  cancelWaitingDispatchForUploadSql,
  expireWaitingDispatchesSql,
  promoteReadyWaitingDispatchSql,
  recoverWaitingDispatchesSql,
  validateWaitingDispatchShape,
  type WaitingUploadDeclaration,
} from "./waitingDispatch.js";

function upload(overrides: Partial<WaitingUploadDeclaration> = {}): WaitingUploadDeclaration {
  return {
    uploadId: crypto.randomUUID(), filename: "photo.jpg", mimeType: "image/jpeg", bytes: 10,
    quality: "auto", kind: "image", stripLocation: true, purpose: "standard", ...overrides,
  };
}

test("waiting attachment groups preserve Telegram-compatible message shapes", () => {
  assert.doesNotThrow(() => validateWaitingDispatchShape("media", Array.from({ length: 10 }, () => upload())));
  assert.doesNotThrow(() => validateWaitingDispatchShape("file", [upload({ kind: "document", mimeType: "application/pdf" })]));
  assert.doesNotThrow(() => validateWaitingDispatchShape("voice", [upload({ kind: "audio", purpose: "voice", mimeType: "audio/mp4" })]));
  assert.doesNotThrow(() => validateWaitingDispatchShape("video-note", [upload({ kind: "video", purpose: "video-note", mimeType: "video/mp4" })]));
  assert.throws(() => validateWaitingDispatchShape("voice", [upload(), upload()]));
  const repeated = upload();
  assert.throws(() => validateWaitingDispatchShape("media", [repeated, repeated]), /unique/);
});

test("waiting dispatch SQL promotes only complete ordered groups and has cancellation recovery", () => {
  assert.match(promoteReadyWaitingDispatchSql, /unnest\(scheduled\.attachment_ids\)/);
  assert.match(promoteReadyWaitingDispatchSql, /attachment\.owner_id=scheduled\.user_id/);
  assert.match(recoverWaitingDispatchesSql, /status='waiting'/);
  assert.match(expireWaitingDispatchesSql, /expires_at<=now\(\)/);
  assert.match(cancelWaitingDispatchForUploadSql, /ANY\(attachment_ids\)/);
});
