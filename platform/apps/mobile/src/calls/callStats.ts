export interface CallNetworkStats {
  pingMs: number | null;
  jitterMs: number | null;
  packetLossPercent: number | null;
  inboundKbps: number;
  outboundKbps: number;
  codecs: string[];
  iceCandidateType: string | null;
  transportProtocol: string | null;
  sampledAt: number;
}

export interface CallStatsBaseline {
  sampledAt: number;
  bytesReceived: number;
  bytesSent: number;
}

export interface ParsedCallStats {
  stats: CallNetworkStats;
  baseline: CallStatsBaseline;
}

type StatsRecord = Record<string, unknown>;

export function parseCallStats(reports: readonly unknown[], previous?: CallStatsBaseline, now = Date.now()): ParsedCallStats {
  const rows = reports.flatMap(normalizeStatsReport);
  const codecs = new Map<string, string>();
  const candidates = new Map<string, StatsRecord>();
  for (const row of rows) {
    if ((row.type === "local-candidate" || row.type === "remote-candidate") && typeof row.id === "string") candidates.set(row.id, row);
    if (row.type !== "codec" || typeof row.id !== "string") continue;
    const mime = typeof row.mimeType === "string" ? row.mimeType.replace(/^audio\//i, "").replace(/^video\//i, "") : null;
    if (mime) codecs.set(row.id, mime.toUpperCase());
  }

  let pingMs: number | null = null;
  let jitterTotal = 0;
  let jitterCount = 0;
  let packetsLost = 0;
  let packetsReceived = 0;
  let bytesReceived = 0;
  let bytesSent = 0;
  const activeCodecs = new Set<string>();
  let iceCandidateType: string | null = null;
  let transportProtocol: string | null = null;

  for (const row of rows) {
    if (row.type === "candidate-pair" && (row.nominated === true || row.selected === true) && row.state === "succeeded") {
      const rtt = finite(row.currentRoundTripTime);
      if (rtt !== null) pingMs = Math.round(rtt * 1_000);
      const local = typeof row.localCandidateId === "string" ? candidates.get(row.localCandidateId) : undefined;
      if (typeof local?.candidateType === "string") iceCandidateType = local.candidateType.slice(0, 24);
      const protocol = typeof local?.protocol === "string" ? local.protocol : typeof row.protocol === "string" ? row.protocol : null;
      const relayProtocol = typeof local?.relayProtocol === "string" ? local.relayProtocol : null;
      if (protocol) transportProtocol = `${protocol}${relayProtocol ? `/${relayProtocol}` : ""}`.slice(0, 24);
    }
    if (row.type === "inbound-rtp" && row.isRemote !== true) {
      const jitter = finite(row.jitter);
      if (jitter !== null) { jitterTotal += jitter * 1_000; jitterCount += 1; }
      packetsLost += Math.max(0, finite(row.packetsLost) ?? 0);
      packetsReceived += Math.max(0, finite(row.packetsReceived) ?? 0);
      bytesReceived += Math.max(0, finite(row.bytesReceived) ?? 0);
      if (typeof row.codecId === "string" && codecs.has(row.codecId)) activeCodecs.add(codecs.get(row.codecId)!);
    }
    if (row.type === "outbound-rtp" && row.isRemote !== true) {
      bytesSent += Math.max(0, finite(row.bytesSent) ?? 0);
      if (typeof row.codecId === "string" && codecs.has(row.codecId)) activeCodecs.add(codecs.get(row.codecId)!);
    }
  }

  const elapsedSeconds = previous ? Math.max(0.25, (now - previous.sampledAt) / 1_000) : 0;
  const inboundKbps = previous ? Math.max(0, Math.round(((bytesReceived - previous.bytesReceived) * 8) / elapsedSeconds / 1_000)) : 0;
  const outboundKbps = previous ? Math.max(0, Math.round(((bytesSent - previous.bytesSent) * 8) / elapsedSeconds / 1_000)) : 0;
  const packetTotal = packetsReceived + packetsLost;

  return {
    stats: {
      pingMs,
      jitterMs: jitterCount ? Math.round((jitterTotal / jitterCount) * 10) / 10 : null,
      packetLossPercent: packetTotal ? Math.round((packetsLost / packetTotal) * 1_000) / 10 : null,
      inboundKbps,
      outboundKbps,
      codecs: [...activeCodecs].sort(),
      iceCandidateType,
      transportProtocol,
      sampledAt: now,
    },
    baseline: { sampledAt: now, bytesReceived, bytesSent },
  };
}

function normalizeStatsReport(report: unknown): StatsRecord[] {
  if (!report) return [];
  if (typeof (report as { forEach?: unknown }).forEach === "function") {
    const rows: StatsRecord[] = [];
    (report as { forEach(callback: (value: unknown) => void): void }).forEach((value) => {
      if (value && typeof value === "object") rows.push(value as StatsRecord);
    });
    return rows;
  }
  if (Array.isArray(report)) return report.filter((value): value is StatsRecord => Boolean(value && typeof value === "object"));
  if (typeof report === "object") return Object.values(report as Record<string, unknown>).filter((value): value is StatsRecord => Boolean(value && typeof value === "object"));
  return [];
}

function finite(value: unknown): number | null {
  const number = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
  return Number.isFinite(number) ? number : null;
}
