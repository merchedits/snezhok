import { db } from "../db/index.js";
import { conversations, conversationMembers, users } from "../db/schema.js";
import { eq, and, ne, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";

/**
 * Finds or creates a 1-on-1 DM conversation between two users
 */
export async function getOrCreateDM(userAId: string, userBId: string) {
  if (userAId === userBId) {
    throw new Error("Cannot start a private conversation with yourself.");
  }

  const targetUser = await db.query.users.findFirst({
    where: eq(users.id, userBId),
    columns: { id: true },
  });
  if (!targetUser) {
    throw new Error("Target user does not exist.");
  }

  // 1. Fetch conversations User A is a member of
  const aMemberships = await db.query.conversationMembers.findMany({
    where: eq(conversationMembers.userId, userAId),
  });

  const aConvIds = aMemberships.map((m) => m.conversationId);

  if (aConvIds.length > 0) {
    // Check if User B is also a member of any of these conversations, and if they are a 'dm'
    const commonMemberships = await db.query.conversationMembers.findMany({
      where: eq(conversationMembers.userId, userBId),
      with: {
        conversation: true,
      },
    });

    const dmConv = commonMemberships.find(
      (m) => aConvIds.includes(m.conversationId) && m.conversation?.type === "dm"
    );

    if (dmConv) {
      return dmConv.conversationId;
    }
  }

  // 2. Create a new DM conversation room since none exists
  const convId = nanoid();
  await db.transaction(async (tx) => {
    await tx.insert(conversations).values({
      id: convId,
      type: "dm",
      createdAt: Date.now(),
    });

    await tx.insert(conversationMembers).values([
      {
        id: nanoid(),
        conversationId: convId,
        userId: userAId,
        joinedAt: Date.now(),
      },
      {
        id: nanoid(),
        conversationId: convId,
        userId: userBId,
        joinedAt: Date.now(),
      },
    ]);
  });

  return convId;
}

export async function createGroupConversation(ownerId: string, memberIds: string[]) {
  const uniqueMemberIds = Array.from(new Set([ownerId, ...memberIds])).filter(Boolean);
  if (uniqueMemberIds.length < 3) {
    throw new Error("Group chats need at least three members.");
  }

  const existingUsers = await db.query.users.findMany({
    where: inArray(users.id, uniqueMemberIds),
    columns: { id: true },
  });
  if (existingUsers.length !== uniqueMemberIds.length) {
    throw new Error("One or more selected users do not exist.");
  }

  const convId = nanoid();
  const now = Date.now();

  await db.transaction(async (tx) => {
    await tx.insert(conversations).values({
      id: convId,
      type: "group",
      createdAt: now,
    });

    await tx.insert(conversationMembers).values(
      uniqueMemberIds.map((userId) => ({
        id: nanoid(),
        conversationId: convId,
        userId,
        joinedAt: now,
      }))
    );
  });

  return convId;
}

/**
 * Returns all active DM conversations a user participates in,
 * including details about the recipient user.
 */
export async function getUserConversations(userId: string) {
  // Find all memberships
  const memberships = await db.query.conversationMembers.findMany({
    where: eq(conversationMembers.userId, userId),
    with: {
      conversation: true,
    },
  });

  const activeConversations = [];

  for (const m of memberships) {
    const conv = m.conversation;
    if (!conv || (conv.type !== "dm" && conv.type !== "group")) continue;

    const members = await db.query.conversationMembers.findMany({
      where: eq(conversationMembers.conversationId, conv.id),
      with: {
        user: {
          columns: {
            id: true,
            username: true,
            displayName: true,
            avatarColor: true,
            avatarUrl: true,
          },
        },
      },
    });

    const memberUsers = members
      .map((member) => member.user)
      .filter(Boolean);

    if (conv.type === "dm") {
      const recipient = memberUsers.find((member) => member.id !== userId);
      if (recipient) {
        activeConversations.push({
          id: conv.id,
          type: conv.type,
          createdAt: conv.createdAt,
          recipient,
          members: memberUsers,
        });
      }
    } else {
      activeConversations.push({
        id: conv.id,
        type: conv.type,
        createdAt: conv.createdAt,
        members: memberUsers,
      });
    }
  }

  return activeConversations.sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * Checks if a user is authorized to read/write in a specific conversation
 */
export async function checkUserAccessToConversation(userId: string, conversationId: string): Promise<boolean> {
  // Global channel is accessible to all registered users
  if (conversationId === "global") {
    const user = await db.query.users.findFirst({
      where: eq(users.id, userId),
      columns: { id: true },
    });
    return !!user;
  }

  const membership = await db.query.conversationMembers.findFirst({
    where: and(
      eq(conversationMembers.conversationId, conversationId),
      eq(conversationMembers.userId, userId)
    ),
  });

  return !!membership;
}
