import assert from "node:assert/strict";
import test from "node:test";

import { appendRecordingLevel, recordingMeterLevel, recordingSourceForMicrophone, routeThroughEarpieceForMicrophone } from "./recordingWaveform";

test("maps the microphone selector to supported Android capture paths", () => {
  assert.equal(recordingSourceForMicrophone("system"), "default");
  assert.equal(recordingSourceForMicrophone("phone"), "mic");
  assert.equal(recordingSourceForMicrophone("speakerphone"), "voice_communication");
  assert.equal(routeThroughEarpieceForMicrophone("system"), undefined);
  assert.equal(routeThroughEarpieceForMicrophone("phone"), true);
  assert.equal(routeThroughEarpieceForMicrophone("speakerphone"), false);
});

test("converts recorder dBFS metering into visible normalized levels", () => {
  assert.equal(recordingMeterLevel(undefined), 0.06);
  assert.equal(recordingMeterLevel(-60), 0.06);
  assert.equal(recordingMeterLevel(0), 1);
  assert.ok(recordingMeterLevel(-12) > recordingMeterLevel(-36));
});

test("smooths live levels and caps visible history", () => {
  let levels: number[] = [];
  for (let index = 0; index < 10; index += 1) levels = appendRecordingLevel(levels, index % 2 ? -8 : -50, 4);
  assert.equal(levels.length, 4);
  assert.ok(levels.every((level) => level >= 0.06 && level <= 1));
});
