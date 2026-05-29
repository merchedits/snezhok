import { db } from "../db/index.js";
import { messages, users, files, reactions } from "../db/schema.js";
import { eq, lt, and, desc } from "drizzle-orm";
import { nanoid } from "nanoid";
export async function createMessage({ userId, content, type = "text", fileId = null, replyToId = null, }) {
    const messageId = nanoid();
    const now = Date.now();
    const newMsg = {
        id: messageId,
        userId,
        content: content.trim(),
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
            userId: true, // Wait, in Drizzle query builder it uses schema relations if configured.
        },
    });
    if (!msg)
        return null;
    // Let's do raw joins or direct queries for safety if Drizzle relations are not explicitly defined in schema.ts
    const user = await db.query.users.findFirst({
        where: eq(users.id, msg.userId),
        columns: { id: true, username: true, displayName: true, avatarColor: true },
    });
    const file = msg.fileId
        ? await db.query.files.findFirst({
            where: eq(files.id, msg.fileId),
            columns: { id: true, originalName: true, mimeType: true, sizeBytes: true },
        })
        : null;
    const msgReactions = await db.query.reactions.findMany({
        where: eq(reactions.messageId, msg.id),
    });
    // Group reactions by emoji
    const groupedReactions = {};
    for (const r of msgReactions) {
        if (!groupedReactions[r.emoji]) {
            groupedReactions[r.emoji] = { emoji: r.emoji, count: 0, userIds: [] };
        }
        groupedReactions[r.emoji].count++;
        groupedReactions[r.emoji].userIds.push(r.userId);
    }
    return {
        ...msg,
        user,
        file,
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
    });
    // Since we retrieved messages in reverse order (newest first), reverse them back for chronological view
    const reversed = [...rawMessages].reverse();
    // Populate user, file, and reactions details
    const populated = await Promise.all(reversed.map(async (msg) => {
        const user = await db.query.users.findFirst({
            where: eq(users.id, msg.userId),
            columns: { id: true, username: true, displayName: true, avatarColor: true },
        });
        const file = msg.fileId
            ? await db.query.files.findFirst({
                where: eq(files.id, msg.fileId),
                columns: { id: true, originalName: true, mimeType: true, sizeBytes: true },
            })
            : null;
        const msgReactions = await db.query.reactions.findMany({
            where: eq(reactions.messageId, msg.id),
        });
        // Group reactions by emoji
        const groupedReactions = {};
        for (const r of msgReactions) {
            if (!groupedReactions[r.emoji]) {
                groupedReactions[r.emoji] = { emoji: r.emoji, count: 0, userIds: [] };
            }
            groupedReactions[r.emoji].count++;
            groupedReactions[r.emoji].userIds.push(r.userId);
        }
        return {
            ...msg,
            user,
            file,
            reactions: Object.values(groupedReactions),
        };
    }));
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
