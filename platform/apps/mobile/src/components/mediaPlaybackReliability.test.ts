import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

test("authenticated thumbnails fall back to the authorized original", async () => {
  const [image, bubble] = await Promise.all([
    source("./AuthenticatedImage.tsx"),
    source("./MessageBubble.tsx"),
  ]);
  assert.match(image, /fallbackUri\?: string \| null/);
  assert.match(image, /setUsingFallback\(true\)/);
  assert.match(image, /Authenticated image failed/);
  assert.match(bubble, /fallbackUri=\{attachment\.thumbnailUrl \? attachment\.url : null\}/);
  assert.match(bubble, /fallbackUri=\{attachment\.url\}/);
});

test("voice and video playback failures remain retryable", async () => {
  const [voice, video] = await Promise.all([
    source("./VoiceMessageAttachment.tsx"),
    source("./VideoViewer.tsx"),
  ]);
  assert.match(voice, /status\.error \|\| playbackFailed/);
  assert.match(voice, /Voice playback failed/);
  assert.match(video, /useEventListener\(player, "statusChange"/);
  assert.match(video, /onRetry=\{\(\) => setAttempt/);
  assert.match(video, /Video playback failed/);
});

test("single media messages keep their aspect ratio and overlay compact metadata", async () => {
  const [image, bubble] = await Promise.all([
    source("./AuthenticatedImage.tsx"),
    source("./MessageBubble.tsx"),
  ]);
  assert.match(image, /onIntrinsicSize\?: \(width: number, height: number\)/);
  assert.match(bubble, /resizeMode="contain"/);
  assert.match(bubble, /mediaOnly && styles\.mediaBubble/);
  assert.match(bubble, /styles\.mediaMetaOverlay/);
  assert.match(bubble, /styles\.mediaReactionOverlay/);
  assert.match(bubble, /StyleSheet\.hairlineWidth/);
  assert.match(bubble, /<View style=\{\[styles\.footer,/);
});
