import { db } from "../db/index.js";
import { conversations, conversationMembers, users } from "../db/schema.js";
import { eq, and, ne } from "drizzle-orm";
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

  const activeDMs = [];

  for (const m of memberships) {
    const conv = m.conversation;
    if (!conv || conv.type !== "dm") continue;

    // Find the other member of this DM
    const otherMember = await db.query.conversationMembers.findFirst({
      where: and(
        eq(conversationMembers.conversationId, conv.id),
        ne(conversationMembers.userId, userId)
      ),
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

    if (otherMember?.user) {
      activeDMs.push({
        id: conv.id,
        type: conv.type,
        createdAt: conv.createdAt,
        recipient: otherMember.user,
      });
    }
  }

  // Sort DMs: newest DMs first
  return activeDMs.sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * Checks if a user is authorized to read/write in a specific conversation
 */
export async function checkUserAccessToConversation(userId: string, conversationId: string): Promise<boolean> {
  // Global channel is accessible to all registered users
  if (conversationId === "global") {
    return true;
  }

  const membership = await db.query.conversationMembers.findFirst({
    where: and(
      eq(conversationMembers.conversationId, conversationId),
      eq(conversationMembers.userId, userId)
    ),
  });

  return !!membership;
}
