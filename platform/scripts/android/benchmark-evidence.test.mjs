import assert from "node:assert/strict";
import test from "node:test";
import { validateBenchmarkReports } from "./benchmark-evidence.mjs";

function report({ startup = 900, frame = Array(100).fill(8) } = {}) {
  const frameBenchmark = (name) => ({ name, sampledMetrics: { frameDurationCpuMs: { runs: [frame] }, frameOverrunMs: { runs: [frame.map((value) => value - 16.67)] } } });
  return {
    benchmarks: [
      { name: "coldStartupWithProfile", metrics: { timeToInitialDisplayMs: { median: startup } } },
      { name: "warmCachedChatReopen", metrics: {} },
      frameBenchmark("messageListScroll"),
      frameBenchmark("attachmentDrawerScroll"),
      { name: "composerKeyboardTransition", metrics: {} },
    ],
  };
}

test("accepts complete physical benchmark evidence within budgets", () => {
  assert.deepEqual(validateBenchmarkReports([report()]), { failures: [], benchmarks: 5 });
});

test("rejects missing journeys, startup regression, jank and missed frames", () => {
  const failing = report({ startup: 1_900, frame: [...Array(90).fill(8), ...Array(10).fill(40)] });
  failing.benchmarks = failing.benchmarks.filter((benchmark) => benchmark.name !== "composerKeyboardTransition");
  const result = validateBenchmarkReports([failing]);
  assert(result.failures.some((failure) => failure.includes("composerKeyboardTransition")));
  assert(result.failures.some((failure) => failure.includes("exceeds 1800")));
  assert(result.failures.some((failure) => failure.includes("exceeds 32")));
  assert(result.failures.some((failure) => failure.includes("missed-frame rate")));
});
