import type { ConversationSummary, FriendEntry, UserSummary } from "@snezhok/contracts";

export interface PeopleGateway {
  searchUsers(query: string): Promise<UserSummary[]>;
  createConversation(participantIds: string[], title?: string): Promise<ConversationSummary>;
  createGroup(participantIds: string[], title: string): Promise<ConversationSummary>;
  requestFriend(username: string): Promise<FriendEntry>;
  respondFriend(requestId: string, action: "accept" | "decline"): Promise<FriendEntry>;
  cancelFriendRequest(requestId: string): Promise<void>;
  removeFriend(userId: string): Promise<void>;
  blockUser(userId: string): Promise<void>;
  unblockUser(userId: string): Promise<unknown>;
}

export function createPeopleUseCases(gateway: PeopleGateway) {
  return {
    search: (query: string) => gateway.searchUsers(query.trim()),
    openDirect: async (conversations: readonly ConversationSummary[], userId: string) => {
      const existing = conversations.find((conversation) => conversation.kind === "direct" && conversation.participants.some((participant) => participant.id === userId));
      if (existing) return { conversation: existing, created: false } as const;
      return { conversation: await gateway.createConversation([userId]), created: true } as const;
    },
    createDirect: (userId: string) => gateway.createConversation([userId]),
    createGroup: (users: readonly UserSummary[], title: string) => gateway.createGroup(users.map((user) => user.id), title.trim()),
    requestFriend: (username: string) => gateway.requestFriend(username.trim().replace(/^@/, "")),
    respondFriend: (requestId: string, action: "accept" | "decline") => gateway.respondFriend(requestId, action),
    cancelFriendRequest: (requestId: string) => gateway.cancelFriendRequest(requestId),
    removeFriend: (userId: string) => gateway.removeFriend(userId),
    blockUser: (userId: string) => gateway.blockUser(userId),
    unblockUser: (userId: string) => gateway.unblockUser(userId),
  };
}
