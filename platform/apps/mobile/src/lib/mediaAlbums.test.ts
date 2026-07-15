import assert from "node:assert/strict";
import test from "node:test";

import { chunkMediaMessages, mediaAlbumRows } from "./mediaAlbums";

test("twenty-three media attachments become 10, 10 and 3 message albums", () => {
  assert.deepEqual(chunkMediaMessages(Array.from({ length: 23 }, (_, index) => index)).map((chunk) => chunk.length), [10, 10, 3]);
});

test("large albums use compact balanced rows", () => {
  assert.deepEqual(mediaAlbumRows(Array.from({ length: 10 }, (_, index) => index)).map((row) => row.length), [3, 3, 4]);
  assert.deepEqual(mediaAlbumRows(Array.from({ length: 7 }, (_, index) => index)).map((row) => row.length), [2, 2, 3]);
});
