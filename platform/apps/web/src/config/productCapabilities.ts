/** Web mirrors the checked-in Android product gate; server code remains dormant. */
export const productCapabilities = {
  servers: false,
} as const;

export function isUserVisibleStreamKind(kind: "conversation" | "channel"): boolean {
  return kind === "conversation" || productCapabilities.servers;
}
