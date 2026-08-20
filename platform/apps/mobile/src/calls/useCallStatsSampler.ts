import { useEffect, useRef } from "react";
import type { Room } from "livekit-client";

import { parseCallStats, type CallNetworkStats, type CallStatsBaseline } from "./callStats";

/** Samples WebRTC reports without making the provider own timer lifecycle. */
export function useCallStatsSampler(room: Room | null, onStats: (stats: CallNetworkStats) => void): void {
  const baseline = useRef<CallStatsBaseline | undefined>(undefined);
  const onStatsRef = useRef(onStats);
  onStatsRef.current = onStats;

  useEffect(() => {
    baseline.current = undefined;
    if (!room) return;
    let disposed = false;
    const sample = async () => {
      const reports = await collectRoomStats(room);
      if (disposed) return;
      const parsed = parseCallStats(reports, baseline.current);
      baseline.current = parsed.baseline;
      onStatsRef.current(parsed.stats);
    };
    const interval = setInterval(() => { void sample(); }, 3_000);
    void sample();
    return () => {
      disposed = true;
      clearInterval(interval);
      baseline.current = undefined;
    };
  }, [room]);
}

async function collectRoomStats(room: Room): Promise<unknown[]> {
  const tracks = [
    ...room.localParticipant.trackPublications.values(),
    ...[...room.remoteParticipants.values()].flatMap((participant) => [...participant.trackPublications.values()]),
  ];
  return (await Promise.all(tracks.map(async (publication) => {
    const track = publication.track;
    if (!track || !("getRTCStatsReport" in track) || typeof track.getRTCStatsReport !== "function") return null;
    return track.getRTCStatsReport().catch(() => undefined);
  }))).filter(Boolean) as unknown[];
}
