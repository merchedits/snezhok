export type CallStreamKind = "conversation" | "channel";
export type CallConversationKind = "direct" | "group" | null;

export interface VoiceChannelGrantPolicy {
  canConnect: boolean;
  canSpeak: boolean;
  canUseVideo: boolean;
  canShareScreen: boolean;
}

/** A participant leaving is not equivalent to an owner ending a shared room. */
export function localLeaveEndsSession(streamKind: CallStreamKind, conversationKind: CallConversationKind): boolean {
  return streamKind === "conversation" && conversationKind === "direct";
}

/**
 * Converts Snezhok's effective channel permissions into the media capabilities
 * that must be encoded in a LiveKit token. Kept pure so authorization can be
 * tested without minting a JWT or opening a database.
 */
export function voiceChannelGrantPolicy(permissions: readonly string[]): VoiceChannelGrantPolicy {
  const allowed = new Set(permissions);
  return {
    canConnect: allowed.has("connect"),
    canSpeak: allowed.has("speak"),
    canUseVideo: allowed.has("video"),
    canShareScreen: allowed.has("screen_share"),
  };
}
