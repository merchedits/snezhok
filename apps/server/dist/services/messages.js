import { db } from "../db/index.js";
import { messages, reactions } from "../db/schema.js";
import { eq, lt, and, desc } from "drizzle-orm";
import { nanoid } from "nanoid";
export async function createMessage({ userId, content, type = "text", fileId = null, replyToId = null, }) {
    if (!content || typeof content !== "string") {
        throw new Error("Message content is required.");
    }
    const trimmedContent = content.trim();
    if (!trimmedContent) {
        throw new Error("Message content cannot be empty.");
    }
    if (trimmedContent.length > 4000) {
        throw new Error("Message content exceeds maximum length of 4000 characters.");
    }
    const messageId = nanoid();
    const now = Date.now();
    const newMsg = {
        id: messageId,
        userId,
        content: trimmedContent,
        type,
        fileId,
        replyToId,
        createdAt: now,
    };
    await db.insert(messages).values(newMsg);
    // Return the newly created message with joined user, file, and empty reactions
    return await getMessageById(messageId);
}
export async function getMessageById(messageId) {
    const msg = await db.query.messages.findFirst({
        where: eq(messages.id, messageId),
        with: {
            user: {
                columns: { id: true, username: true, displayName: true, avatarColor: true, avatarUrl: true },
            },
            file: {
                columns: { id: true, originalName: true, mimeType: true, sizeBytes: true },
            },
            reactions: true,
        },
    });
    if (!msg)
        return null;
    // Group reactions by emoji
    const groupedReactions = {};
    for (const r of msg.reactions) {
        if (!groupedReactions[r.emoji]) {
            groupedReactions[r.emoji] = { emoji: r.emoji, count: 0, userIds: [] };
        }
        groupedReactions[r.emoji].count++;
        groupedReactions[r.emoji].userIds.push(r.userId);
    }
    return {
        ...msg,
        reactions: Object.values(groupedReactions),
    };
}
export async function getMessages(beforeTimestamp, limit = 50) {
    const conditions = beforeTimestamp
        ? lt(messages.createdAt, beforeTimestamp)
        : undefined;
    const rawMessages = await db.query.messages.findMany({
        where: conditions,
        orderBy: [desc(messages.createdAt)],
        limit,
        with: {
            user: {
                columns: { id: true, username: true, displayName: true, avatarColor: true, avatarUrl: true },
            },
            file: {
                columns: { id: true, originalName: true, mimeType: true, sizeBytes: true },
            },
            reactions: true,
        },
    });
    // Since we retrieved messages in reverse order (newest first), reverse them back for chronological view
    const reversed = [...rawMessages].reverse();
    // Populate reactions details
    const populated = reversed.map((msg) => {
        // Group reactions by emoji
        const groupedReactions = {};
        for (const r of msg.reactions) {
            if (!groupedReactions[r.emoji]) {
                groupedReactions[r.emoji] = { emoji: r.emoji, count: 0, userIds: [] };
            }
            groupedReactions[r.emoji].count++;
            groupedReactions[r.emoji].userIds.push(r.userId);
        }
        return {
            ...msg,
            reactions: Object.values(groupedReactions),
        };
    });
    return populated;
}
export async function addReaction(messageId, userId, emoji) {
    // Check if user already reacted with this emoji
    const existing = await db.query.reactions.findFirst({
        where: and(eq(reactions.messageId, messageId), eq(reactions.userId, userId), eq(reactions.emoji, emoji)),
    });
    if (existing)
        return;
    await db.insert(reactions).values({
        id: nanoid(),
        messageId,
        userId,
        emoji,
        createdAt: Date.now(),
    });
}
export async function removeReaction(messageId, userId, emoji) {
    await db
        .delete(reactions)
        .where(and(eq(reactions.messageId, messageId), eq(reactions.userId, userId), eq(reactions.emoji, emoji)));
}
export async function deleteMessage(messageId, userId, isAdmin) {
    const msg = await db.query.messages.findFirst({
        where: eq(messages.id, messageId),
    });
    if (!msg) {
        throw new Error("Message not found.");
    }
    // Only message author or admin can delete
    if (msg.userId !== userId && !isAdmin) {
        throw new Error("You do not have permission to delete this message.");
    }
    // Delete associated reactions first
    await db.delete(reactions).where(eq(reactions.messageId, messageId));
    // Delete the message
    await db.delete(messages).where(eq(messages.id, messageId));
    return { id: messageId };
}
export async function editMessage(messageId, userId, newContent, isAdmin) {
    const msg = await db.query.messages.findFirst({
        where: eq(messages.id, messageId),
    });
    if (!msg) {
        throw new Error("Message not found.");
    }
    // Only message author or admin can edit
    if (msg.userId !== userId && !isAdmin) {
        throw new Error("You do not have permission to edit this message.");
    }
    const trimmedContent = newContent.trim();
    if (!trimmedContent) {
        throw new Error("Message content cannot be empty.");
    }
    if (trimmedContent.length > 4000) {
        throw new Error("Message content exceeds maximum length of 4000 characters.");
    }
    const now = Date.now();
    await db.update(messages)
        .set({ content: trimmedContent, editedAt: now })
        .where(eq(messages.id, messageId));
    return await getMessageById(messageId);
}
