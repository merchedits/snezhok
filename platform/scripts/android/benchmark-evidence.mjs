const REQUIRED_FRAME_JOURNEYS = ["messageListScroll", "attachmentDrawerScroll"];

export function validateBenchmarkReports(reports) {
  const failures = [];
  const benchmarks = reports.flatMap((report) => Array.isArray(report?.benchmarks) ? report.benchmarks : []);
  const required = ["coldStartupWithProfile", "warmCachedChatReopen", ...REQUIRED_FRAME_JOURNEYS, "composerKeyboardTransition"];
  for (const name of required) {
    if (!findBenchmark(benchmarks, name)) failures.push(`missing benchmark journey: ${name}`);
  }

  const startup = findBenchmark(benchmarks, "coldStartupWithProfile");
  const startupMedian = startup?.metrics?.timeToInitialDisplayMs?.median;
  if (!Number.isFinite(startupMedian)) failures.push("cold startup report has no timeToInitialDisplayMs median");
  else if (startupMedian > 1_800) failures.push(`cold startup median ${startupMedian.toFixed(1)} ms exceeds 1800 ms`);

  for (const name of REQUIRED_FRAME_JOURNEYS) {
    const benchmark = findBenchmark(benchmarks, name);
    if (!benchmark) continue;
    const durations = sampledValues(benchmark.sampledMetrics?.frameDurationCpuMs);
    const reportedP95 = percentileValue(benchmark.sampledMetrics?.frameDurationCpuMs, 95);
    const p95 = reportedP95 ?? (durations.length ? percentile(durations, 0.95) : null);
    if (!Number.isFinite(p95)) failures.push(`${name} has no frameDurationCpuMs P95 evidence`);
    else if (p95 > 32) failures.push(`${name} frameDurationCpuMs P95 ${p95.toFixed(1)} ms exceeds 32 ms`);

    const overruns = sampledValues(benchmark.sampledMetrics?.frameOverrunMs);
    const missedRate = overruns.length
      ? overruns.filter((value) => value > 0).length / overruns.length
      : durations.length ? durations.filter((value) => value > 16.67).length / durations.length : null;
    if (!Number.isFinite(missedRate)) failures.push(`${name} has no sampled frame evidence for missed-frame rate`);
    else if (missedRate >= 0.05) failures.push(`${name} missed-frame rate ${(missedRate * 100).toFixed(2)}% is not below 5%`);
  }

  return { failures, benchmarks: benchmarks.length };
}

function findBenchmark(benchmarks, name) {
  return benchmarks.find((benchmark) => typeof benchmark?.name === "string" && benchmark.name.includes(name));
}

function percentileValue(metric, percentileNumber) {
  if (!metric || typeof metric !== "object") return null;
  for (const key of [`P${percentileNumber}`, `p${percentileNumber}`, `percentile${percentileNumber}`]) {
    if (Number.isFinite(metric[key])) return metric[key];
  }
  return null;
}

function sampledValues(metric) {
  if (!metric || typeof metric !== "object") return [];
  return flattenNumbers(metric.runs).filter((value) => Number.isFinite(value));
}

function flattenNumbers(value) {
  if (Number.isFinite(value)) return [value];
  if (Array.isArray(value)) return value.flatMap(flattenNumbers);
  return [];
}

function percentile(values, fraction) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1))] ?? null;
}
