import { unsign } from "@fastify/cookie";
import { config } from "./config.js";

export function resolveSessionCookie(rawSessionId?: string): string | null {
  if (!rawSessionId) return null;

  const unsigned = unsign(rawSessionId, config.SESSION_SECRET);
  if (unsigned.valid && unsigned.value) {
    return unsigned.value;
  }

  // Temporary compatibility for old unsigned cookies created before signing.
  if (!rawSessionId.includes(".")) {
    return rawSessionId;
  }

  return null;
}
