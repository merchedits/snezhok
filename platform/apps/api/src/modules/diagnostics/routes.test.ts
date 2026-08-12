import assert from "node:assert/strict";
import test from "node:test";
import { sanitizeDiagnosticReport } from "./routes.js";

test("diagnostic reports omit identities and redact untrusted client fields", () => {
  const installationId = "5811d22d-1e72-4b86-bf0a-8435aa34b15c";
  const sanitized = sanitizeDiagnosticReport({
    installationId,
    appVersion: "3.8.1",
    versionCode: 26,
    platform: "android",
    osVersion: "31",
    device: "Personal phone",
    locale: "ru",
    recordedAt: 1,
    events: [{
      at: 1,
      level: "warn",
      category: "network",
      message: "password=hunter2 user@example.com",
      context: {
        path: `/users/${installationId}/profile?token=secret`,
        email: "user@example.com",
        arbitrary: "must not be logged",
      },
    }],
  });
  const encoded = JSON.stringify(sanitized);
  assert.doesNotMatch(encoded, /5811d22d/);
  assert.doesNotMatch(encoded, /hunter2|user@example\.com|must not be logged/);
  assert.equal(sanitized.events[0]?.message, "Unrecognized diagnostic event");
  assert.equal(sanitized.events[0]?.context?.path, "/users/[id]/profile?token=[redacted]");
  assert.equal("device" in sanitized, false);
});

test("diagnostic reports retain allowlisted operational signals", () => {
  const sanitized = sanitizeDiagnosticReport({
    installationId: "installation-123",
    appVersion: "3.8.1",
    versionCode: 26,
    platform: "android",
    osVersion: "31",
    device: "SM-A125F",
    locale: "ru",
    recordedAt: 2,
    events: [{
      at: 2,
      level: "warn",
      category: "performance",
      message: "tabResponse",
      durationMs: 47.3,
      context: { from: "chats", to: "servers", budgetMs: 17, passed: false },
    }],
  });
  assert.deepEqual(sanitized.events[0], {
    at: 2,
    level: "warn",
    category: "performance",
    message: "tabResponse",
    durationMs: 47.3,
    context: { from: "chats", to: "servers", budgetMs: 17, passed: false },
  });
});

test("media decoder failures remain useful without retaining file identity", () => {
  const report = sanitizeDiagnosticReport({
    installationId: "device-installation-test",
    appVersion: "4.2.0",
    versionCode: 37,
    platform: "android",
    osVersion: "14",
    device: "Android",
    locale: "en",
    recordedAt: 10,
    events: [{
      at: 9,
      level: "warn",
      category: "media",
      message: "Voice playback failed",
      context: { failure: "native-player", attachmentId: "not-retained" },
    }],
  });
  assert.equal(report.events[0]?.message, "Voice playback failed");
  assert.deepEqual(report.events[0]?.context, { failure: "native-player" });
});
