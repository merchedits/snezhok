import assert from "node:assert/strict";
import test from "node:test";
import { combinedRating, isYandexMusicUrl, memoryRevealDate, normalizeGuess, parseDrawingStrokes, validSongUrl } from "./rules.js";

test("draw guesses compare normalized Russian text", () => {
  assert.equal(normalizeGuess("  ЁЖИК!!! "), "ежик");
  assert.equal(normalizeGuess("СНЕЖНЫЙ—ШАР"), "снежный шар");
});

test("movie ratings expose the arithmetic mean without a compatibility score", () => {
  assert.equal(combinedRating({ one: 9, two: 5 }), 7);
  assert.equal(combinedRating({ one: 8, ignored: 99 }), 8);
  assert.equal(combinedRating({}), null);
});

test("memory reveal dates clamp the day at month boundaries", () => {
  assert.equal(memoryRevealDate(new Date("2026-01-31T12:00:00.000Z"), 1).toISOString(), "2026-02-28T12:00:00.000Z");
});

test("song links require HTTPS and recognize Yandex Music hosts exactly", () => {
  assert.equal(validSongUrl("https://music.yandex.ru/album/1/track/2"), true);
  assert.equal(validSongUrl("javascript:alert(1)"), false);
  assert.equal(isYandexMusicUrl("https://music.yandex.ru/album/1"), true);
  assert.equal(isYandexMusicUrl("https://music.yandex.ru.evil.test/album/1"), false);
});

test("drawings accept only bounded numeric strokes inside their canvas", () => {
  assert.deepEqual(parseDrawingStrokes([[[0, 0], [300, 240]]], 300, 240), [[[0, 0], [300, 240]]]);
  assert.equal(parseDrawingStrokes([[{ x: 1 }, [2, 2]]], 300, 240), null);
  assert.equal(parseDrawingStrokes([[[0, 0], [301, 2]]], 300, 240), null);
  assert.equal(parseDrawingStrokes(Array.from({ length: 201 }, () => [[0, 0], [1, 1]]), 300, 240), null);
});
