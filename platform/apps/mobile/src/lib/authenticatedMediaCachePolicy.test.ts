import assert from "node:assert/strict";
import test from "node:test";

import { authenticatedMediaFilename, extensionForMimeType } from "./authenticatedMediaCachePolicy";

test("authenticated media cache keeps variants separate and uses decoder-friendly extensions", () => {
  const attachment = "c0b74091-3358-44a3-b837-1396a09e170f";
  const primary = authenticatedMediaFilename(attachment, `/api/v1/files/${attachment}?variant=primary`, "image/webp");
  const thumbnail = authenticatedMediaFilename(attachment, `/api/v1/files/${attachment}?variant=thumbnail`, "image/webp");
  assert.notEqual(primary, thumbnail);
  assert.match(primary, /^[a-zA-Z0-9_-]+-[0-9a-f]{16}\.webp$/);
  assert.equal(extensionForMimeType("audio/ogg; codecs=opus"), "ogg");
  assert.equal(extensionForMimeType("audio/mp4"), "mp4");
});

test("authenticated media cache strips unsafe filename characters", () => {
  const filename = authenticatedMediaFilename("../../voice message", "https://example.test/audio", "audio/ogg");
  assert.equal(filename.includes(".."), false);
  assert.equal(filename.includes("/"), false);
  assert.match(filename, /^voicemessage-[0-9a-f]{16}\.ogg$/);
});
