import type { GlobalPermission } from "../lib/api";

/**
 * Checked-in product switches for capabilities that remain implemented but are
 * intentionally absent from the current Android experience. These are release
 * decisions, not remote flags: changing one requires review, tests and a new
 * signed client.
 */
export const productCapabilities = {
  servers: false,
} as const;

export type UserVisibleStreamKind = "conversation" | "channel";

export function isUserVisibleStreamKind(kind: UserVisibleStreamKind): boolean {
  return kind === "conversation" || productCapabilities.servers;
}

export const notificationPreferenceTabs = productCapabilities.servers
  ? (["global", "servers", "streams"] as const)
  : (["global", "streams"] as const);

const allGlobalPermissions: readonly GlobalPermission[] = ["createServers", "createGroups", "uploadFiles", "startCalls"];

export const userVisibleGlobalPermissions = allGlobalPermissions.filter(
  (permission) => permission !== "createServers" || productCapabilities.servers,
);
