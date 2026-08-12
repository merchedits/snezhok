import assert from "node:assert/strict";
import test from "node:test";

import type { Message } from "@snezhok/contracts";

import { chatOpenPerformanceKind, recentMediaPreviewUris, uncachedWarmStreamIds } from "./chatWarmup";

test("chat diagnostics distinguish in-memory warm opens from SQLite cache restores", () => {
  assert.equal(chatOpenPerformanceKind(1), "warmChatOpen");
  assert.equal(chatOpenPerformanceKind(80), "warmChatOpen");
  assert.equal(chatOpenPerformanceKind(0), "cachedChatOpen");
});

test("chat warmup selects recent thumbnails without preloading full videos", () => {
  const base = { streamId: "chat", attachments: [], sequence: 1 } as unknown as Message;
  const messages = [
    { ...base, id: "older", attachments: [{ kind: "image", url: "/old.jpg", thumbnailUrl: "/old-thumb.jpg" }] },
    { ...base, id: "newer", sequence: 2, attachments: [
      { kind: "video", url: "/large.mp4", thumbnailUrl: "/video-thumb.jpg" },
      { kind: "image", url: "/image.jpg", thumbnailUrl: null },
    ] },
  ] as Message[];

  assert.deepEqual(recentMediaPreviewUris({ chat: messages }, ["chat"]), ["/image.jpg", "/video-thumb.jpg", "/old-thumb.jpg"]);
});

test("chat warmup restores only missing visible streams within its memory budget", () => {
  const cached = [{ id: "message" }] as unknown as Message[];
  assert.deepEqual(
    uncachedWarmStreamIds(["saved", "one", "two", "one", "three"], { saved: cached, two: cached }, 2),
    ["one", "three"],
  );
  assert.deepEqual(uncachedWarmStreamIds(["one"], {}, 0), []);
});
