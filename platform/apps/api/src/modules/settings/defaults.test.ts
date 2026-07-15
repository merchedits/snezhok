import assert from "node:assert/strict";
import test from "node:test";
import { defaultSettings } from "./defaults.js";

test("production defaults favor automatic media and standard speech processing", () => {
  assert.equal(defaultSettings.defaultUploadQuality, "auto");
  assert.equal(defaultSettings.noiseSuppression, "standard");
  assert.equal(defaultSettings.echoCancellation, true);
  assert.equal(defaultSettings.microphoneMode, "phone");
  assert.equal(defaultSettings.callAudioRoute, "auto");
  assert.equal(defaultSettings.callQuality, "auto");
  assert.equal(defaultSettings.screenShareQuality, "auto");
  assert.equal(defaultSettings.autoDownloadMobile, false);
});
