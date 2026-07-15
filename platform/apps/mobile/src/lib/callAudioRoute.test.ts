import assert from "node:assert/strict";
import test from "node:test";
import { availableAudioRoutes, nextAudioRoute, preferredAudioOutputs } from "./callAudioRoute";

test("explicit Bluetooth and wired routes remain preferred", () => {
  assert.equal(preferredAudioOutputs("bluetooth", "phone")[0], "bluetooth");
  assert.equal(preferredAudioOutputs("headset", "speakerphone")[0], "headset");
});

test("phone and speakerphone modes choose their matching communication path", () => {
  assert.ok(preferredAudioOutputs("auto", "phone").indexOf("earpiece") < preferredAudioOutputs("auto", "phone").indexOf("speaker"));
  assert.ok(preferredAudioOutputs("auto", "speakerphone").indexOf("speaker") < preferredAudioOutputs("auto", "speakerphone").indexOf("earpiece"));
});

test("route cycling ignores unavailable Android devices", () => {
  const routes = availableAudioRoutes(["speaker", "bluetooth", "unknown"]);
  assert.deepEqual(routes, ["speaker", "bluetooth"]);
  assert.equal(nextAudioRoute("speaker", routes), "bluetooth");
  assert.equal(nextAudioRoute("bluetooth", routes), "speaker");
});
