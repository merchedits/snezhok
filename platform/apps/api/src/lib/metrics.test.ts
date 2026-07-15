import assert from "node:assert/strict";
import test from "node:test";
import { incrementMetric, metricsSnapshot, observeHttpRequest } from "./metrics.js";

test("metrics aggregate normalized routes without retaining user identifiers", () => {
  observeHttpRequest("get", "/api/v1/streams/7a840dc2-96ac-4cce-a276-5ffbbfe15225/messages?limit=60", 200, 12);
  observeHttpRequest("get", "/api/v1/streams/7a840dc2-96ac-4cce-a276-5ffbbfe15225/messages", 503, 28);
  incrementMetric("realtime.deliveries", 2);
  const snapshot = metricsSnapshot();
  const route = snapshot.routes.find((item) => item.route.includes("streams/:id/messages"));
  assert.deepEqual(route, { route: "GET /api/v1/streams/:id/messages", requests: 2, errors: 1, averageDurationMs: 20, maxDurationMs: 28 });
  assert.equal(snapshot.counters["realtime.deliveries"], 2);
});
