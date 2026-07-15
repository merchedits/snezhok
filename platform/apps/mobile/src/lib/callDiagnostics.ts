export type CallFailureKind = "permission" | "authentication" | "network" | "relay" | "media" | "server" | "unknown";

export function classifyCallFailure(reason: unknown): CallFailureKind {
  const text = reason instanceof Error ? `${reason.name} ${reason.message}`.toLowerCase() : String(reason ?? "").toLowerCase();
  if (/permission|notallowed|denied/.test(text)) return "permission";
  if (/token|auth|unauthorized|forbidden/.test(text)) return "authentication";
  if (/turn|relay|ice failed|candidate/.test(text)) return "relay";
  if (/microphone|camera|media|track|device/.test(text)) return "media";
  if (/timeout|network|websocket|connection|offline/.test(text)) return "network";
  if (/server|internal|unavailable|room/.test(text)) return "server";
  return "unknown";
}
