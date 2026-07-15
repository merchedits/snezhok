export type CallAudioRoute = "auto" | "earpiece" | "speaker" | "headset" | "bluetooth";

const knownRoutes: readonly Exclude<CallAudioRoute, "auto">[] = ["earpiece", "speaker", "headset", "bluetooth"];

export function preferredAudioOutputs(route: CallAudioRoute, microphoneMode: "system" | "phone" | "speakerphone") {
  if (route !== "auto") return [route, ...knownRoutes.filter((candidate) => candidate !== route)];
  if (microphoneMode === "speakerphone") return ["bluetooth", "headset", "speaker", "earpiece"] as const;
  if (microphoneMode === "phone") return ["bluetooth", "headset", "earpiece", "speaker"] as const;
  return ["bluetooth", "headset", "speaker", "earpiece"] as const;
}

export function availableAudioRoutes(outputs: readonly string[]): Exclude<CallAudioRoute, "auto">[] {
  const available = new Set(outputs);
  return knownRoutes.filter((route) => available.has(route));
}

export function nextAudioRoute(current: string, available: readonly Exclude<CallAudioRoute, "auto">[]) {
  if (!available.length) return null;
  const index = available.indexOf(current as Exclude<CallAudioRoute, "auto">);
  return available[(index + 1 + available.length) % available.length] ?? available[0] ?? null;
}
