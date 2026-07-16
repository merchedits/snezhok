import assert from "node:assert/strict";
import test from "node:test";

import { nativeExitSeverity, parseNativeCrashSummary } from "./nativeExitPolicy";

test("only abnormal Android exits enter diagnostics", () => {
  assert.equal(nativeExitSeverity("anr"), "error");
  assert.equal(nativeExitSeverity("native-crash"), "error");
  assert.equal(nativeExitSeverity("low-memory"), "warn");
  assert.equal(nativeExitSeverity("user-requested"), null);
  assert.equal(nativeExitSeverity("package-updated"), null);
});

test("native crash ingestion excludes exception messages and stack frames", () => {
  const summary = parseNativeCrashSummary(JSON.stringify({
    recordedAt: 123,
    thread: "main",
    type: "java.lang.IllegalStateException",
    message: "private chat text",
    stack: ["private frame"],
  }));
  assert.deepEqual(summary, { recordedAt: 123, thread: "main", type: "java.lang.IllegalStateException" });
  assert.equal(parseNativeCrashSummary("not-json"), null);
});
