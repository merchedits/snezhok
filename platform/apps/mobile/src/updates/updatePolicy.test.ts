import assert from "node:assert/strict";
import test from "node:test";
import { arrayBufferToHex, isNewerRelease, isRequired, monotonicDownloadProgress } from "./updatePolicy.js";

test("release version codes determine update availability", () => {
  assert.equal(isNewerRelease(3, 2), true);
  assert.equal(isNewerRelease(2, 2), false);
  assert.equal(isNewerRelease(1, 2), false);
});

test("mandatory and minimum version policies are enforced", () => {
  assert.equal(isRequired({ mandatory: false, minimumVersionCode: 2 }, 2), false);
  assert.equal(isRequired({ mandatory: false, minimumVersionCode: 3 }, 2), true);
  assert.equal(isRequired({ mandatory: true, minimumVersionCode: 1 }, 2), true);
});

test("binary digests are rendered as lower-case hexadecimal", () => {
  assert.equal(arrayBufferToHex(Uint8Array.from([0, 15, 16, 255]).buffer), "000f10ff");
});

test("download progress is monotonic and uses the signed manifest size", () => {
  assert.equal(monotonicDownloadProgress(610, 1_000, 0.01), 0.61);
  assert.equal(monotonicDownloadProgress(20, 1_000, 0.61), 0.61);
  assert.equal(monotonicDownloadProgress(1_200, 1_000, 0.61), 1);
  assert.equal(monotonicDownloadProgress(20, 0, 0.61), 0.61);
});
