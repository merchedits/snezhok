export type PublishSource = "camera" | "microphone" | "screen_share" | "screen_share_audio";

export interface LocalPublishPermissions {
  canPublish?: boolean;
  canPublishSources?: readonly unknown[];
}

const protocolSource: Record<PublishSource, number> = {
  camera: 1,
  microphone: 2,
  screen_share: 3,
  screen_share_audio: 4,
};

/**
 * LiveKit may expose token grants as protocol numbers or SDK source strings.
 * An absent local snapshot is not an authorization boundary: the media server
 * remains authoritative and will reject an invalid publication. Treating an
 * as-yet unavailable snapshot as a denial used to produce connected calls with
 * no microphone and no actionable failure.
 */
export function mayPublishSource(permissions: LocalPublishPermissions | null | undefined, source: PublishSource): boolean {
  if (!permissions) return true;
  if (permissions.canPublish === false) return false;
  const allowed = permissions.canPublishSources;
  if (!allowed?.length) return true;
  return allowed.some((candidate) => candidate === source || Number(candidate) === protocolSource[source]);
}
