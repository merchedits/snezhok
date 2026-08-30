import assert from "node:assert/strict";
import test from "node:test";

import { callNetworkQuality, parseCallStats, type CallNetworkStats } from "./callStats";

test("aggregates privacy-safe WebRTC network statistics and deltas", () => {
  const shared = [{ id: "codec-a", type: "codec", mimeType: "audio/opus" }, { id: "candidate-a", type: "local-candidate", candidateType: "relay", protocol: "tcp", relayProtocol: "tls" }, { type: "candidate-pair", nominated: true, state: "succeeded", currentRoundTripTime: 0.052, localCandidateId: "candidate-a" }];
  const first = parseCallStats([[...shared, { type: "inbound-rtp", codecId: "codec-a", jitter: 0.007, packetsLost: 2, packetsReceived: 98, bytesReceived: 1000 }, { type: "outbound-rtp", codecId: "codec-a", bytesSent: 500 }]], undefined, 1_000);
  const second = parseCallStats([[...shared, { type: "inbound-rtp", codecId: "codec-a", jitter: 0.007, packetsLost: 2, packetsReceived: 98, bytesReceived: 11_000 }, { type: "outbound-rtp", codecId: "codec-a", bytesSent: 5_500 }]], first.baseline, 2_000);
  assert.equal(second.stats.pingMs, 52);
  assert.equal(second.stats.jitterMs, 7);
  assert.equal(second.stats.packetLossPercent, 2);
  assert.equal(second.stats.inboundKbps, 80);
  assert.equal(second.stats.outboundKbps, 40);
  assert.deepEqual(second.stats.codecs, ["OPUS"]);
  assert.equal(second.stats.iceCandidateType, "relay");
  assert.equal(second.stats.transportProtocol, "tcp/tls");
});

test("accepts map-like RTCStatsReport values and ignores malformed numbers", () => {
  const report = new Map<string, unknown>([["pair", { type: "candidate-pair", selected: true, state: "succeeded", currentRoundTripTime: "bad" }]]);
  const result = parseCallStats([report], undefined, 5_000);
  assert.equal(result.stats.pingMs, null);
  assert.equal(result.stats.packetLossPercent, null);
});

test("classifies visible call quality from latency, jitter and packet loss", () => {
  const stats: CallNetworkStats = { pingMs: 70, jitterMs: 8, packetLossPercent: 1, inboundKbps: 80, outboundKbps: 40, codecs: [], iceCandidateType: "relay", transportProtocol: "udp", sampledAt: 1 };
  assert.equal(callNetworkQuality(stats), "good");
  assert.equal(callNetworkQuality({ ...stats, pingMs: 250 }), "fair");
  assert.equal(callNetworkQuality({ ...stats, packetLossPercent: 9 }), "poor");
  assert.equal(callNetworkQuality({ ...stats, sampledAt: 0 }), "unknown");
});
