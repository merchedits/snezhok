export function mayDeleteForEveryone(input: {
  streamKind: "conversation" | "channel";
  conversationKind: "direct" | "group" | null;
  actorIsAuthor: boolean;
  actorRole: "owner" | "admin" | "moderator" | "member";
  managesChannelMessages: boolean;
}): boolean {
  if (input.actorIsAuthor) return true;
  if (input.streamKind === "channel") return input.managesChannelMessages;
  if (input.conversationKind === "direct") return true;
  return input.conversationKind === "group" && (input.actorRole === "owner" || input.actorRole === "admin");
}
