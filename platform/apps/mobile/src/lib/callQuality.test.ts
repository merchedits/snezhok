import assert from "node:assert/strict";
import test from "node:test";
import { adaptiveCallQuality, callMediaProfile } from "./callQuality";

test("call presets bound camera, screen and audio bandwidth", () => {
  const saver = callMediaProfile("data-saver", "data-saver");
  const high = callMediaProfile("high", "high");
  assert.ok(saver.audioBitrate < high.audioBitrate);
  assert.ok(saver.camera.maxBitrate < high.camera.maxBitrate);
  assert.ok(saver.screen.frameRate < high.screen.frameRate);
  assert.equal(saver.simulcast, false);
});

test("automatic quality falls back on a poor connection", () => {
  assert.equal(adaptiveCallQuality("auto", "poor"), "data-saver");
  assert.equal(adaptiveCallQuality("auto", "excellent"), "auto");
  assert.equal(adaptiveCallQuality("high", "poor"), "high");
});
