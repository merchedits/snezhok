import assert from "node:assert/strict";
import test from "node:test";

import type { DiagnosticEvent, DiagnosticReport } from "@snezhok/contracts";
import { deliverPendingDiagnostics } from "./diagnosticDelivery";

test("diagnostic delivery retries ambiguous sends before advancing its watermark", async () => {
  let watermark = 10;
  let attempts = 0;
  const event = diagnosticEvent({ at: 20, level: "error" });
  const dependencies = {
    readWatermark: async () => watermark,
    writeWatermark: async (next: number) => { watermark = next; },
    buildReport: async () => report([event]),
    sendReport: async () => { attempts += 1; if (attempts === 1) throw new Error("response lost"); },
  };
  await assert.rejects(deliverPendingDiagnostics(dependencies), /response lost/);
  assert.equal(watermark, 10);
  assert.equal(await deliverPendingDiagnostics(dependencies), 20);
  assert.equal(watermark, 20);
  assert.equal(attempts, 2);
});

test("diagnostic delivery advances past non-reportable routine events without uploading", async () => {
  let watermark = 0;
  let sent = false;
  const next = await deliverPendingDiagnostics({
    readWatermark: async () => watermark,
    writeWatermark: async (value) => { watermark = value; },
    buildReport: async () => report([diagnosticEvent({ at: 15, level: "info" })]),
    sendReport: async () => { sent = true; },
  });
  assert.equal(next, 15);
  assert.equal(watermark, 15);
  assert.equal(sent, false);
});

function diagnosticEvent(overrides: Partial<DiagnosticEvent>): DiagnosticEvent {
  return { id: crypto.randomUUID(), at: 1, level: "warn", category: "crash", message: "Unhandled JavaScript error", ...overrides };
}

function report(events: DiagnosticEvent[]): DiagnosticReport {
  return { installationId: "installation", appVersion: "4.4.0", versionCode: 41, platform: "android", osVersion: "12", device: "SM-A125F", locale: "ru", recordedAt: 30, events };
}
