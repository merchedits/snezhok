import assert from "node:assert/strict";
import test from "node:test";

import { parseCallStats } from "./callStats";

test("aggregates privacy-safe WebRTC network statistics and deltas", () => {
  const first = parseCallStats([[{ id: "codec-a", type: "codec", mimeType: "audio/opus" }, { type: "candidate-pair", nominated: true, state: "succeeded", currentRoundTripTime: 0.052 }, { type: "inbound-rtp", codecId: "codec-a", jitter: 0.007, packetsLost: 2, packetsReceived: 98, bytesReceived: 1000 }, { type: "outbound-rtp", codecId: "codec-a", bytesSent: 500 }]], undefined, 1_000);
  const second = parseCallStats([[{ id: "codec-a", type: "codec", mimeType: "audio/opus" }, { type: "candidate-pair", nominated: true, state: "succeeded", currentRoundTripTime: 0.052 }, { type: "inbound-rtp", codecId: "codec-a", jitter: 0.007, packetsLost: 2, packetsReceived: 98, bytesReceived: 11_000 }, { type: "outbound-rtp", codecId: "codec-a", bytesSent: 5_500 }]], first.baseline, 2_000);
  assert.equal(second.stats.pingMs, 52);
  assert.equal(second.stats.jitterMs, 7);
  assert.equal(second.stats.packetLossPercent, 2);
  assert.equal(second.stats.inboundKbps, 80);
  assert.equal(second.stats.outboundKbps, 40);
  assert.deepEqual(second.stats.codecs, ["OPUS"]);
});

test("accepts map-like RTCStatsReport values and ignores malformed numbers", () => {
  const report = new Map<string, unknown>([["pair", { type: "candidate-pair", selected: true, state: "succeeded", currentRoundTripTime: "bad" }]]);
  const result = parseCallStats([report], undefined, 5_000);
  assert.equal(result.stats.pingMs, null);
  assert.equal(result.stats.packetLossPercent, null);
});
