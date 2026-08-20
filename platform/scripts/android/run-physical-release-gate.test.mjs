import assert from "node:assert/strict";
import test from "node:test";
import { parseAdbDevices, selectDevice } from "./run-physical-release-gate.mjs";

test("physical release runner accepts exactly one authorized device", () => {
  const devices = parseAdbDevices("List of devices attached\nA12 device product:a model:SM-A125F\noffline offline\n");
  assert.equal(selectDevice(devices), "A12");
  assert.equal(selectDevice(devices, "A12"), "A12");
});

test("physical release runner rejects ambiguous or unavailable device selection", () => {
  const devices = parseAdbDevices("List of devices attached\nfirst device\nsecond device\n");
  assert.throws(() => selectDevice(devices), /exactly one/);
  assert.throws(() => selectDevice(devices, "missing"), /not connected/);
});
