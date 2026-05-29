import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
export const users = sqliteTable("users", {
    id: text("id").primaryKey(),
    username: text("username").notNull().unique(),
    passwordHash: text("password_hash").notNull(),
    displayName: text("display_name").notNull(),
    avatarColor: text("avatar_color").notNull(),
    isAdmin: integer("is_admin", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("created_at").notNull(),
    lastSeenAt: integer("last_seen_at").notNull(),
});
export const sessions = sqliteTable("sessions", {
    id: text("id").primaryKey(),
    userId: text("user_id")
        .notNull()
        .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: integer("expires_at").notNull(),
    createdAt: integer("created_at").notNull(),
});
export const files = sqliteTable("files", {
    id: text("id").primaryKey(),
    userId: text("user_id")
        .notNull()
        .references(() => users.id, { onDelete: "cascade" }),
    originalName: text("original_name").notNull(),
    storedName: text("stored_name").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    createdAt: integer("created_at").notNull(),
});
export const messages = sqliteTable("messages", {
    id: text("id").primaryKey(),
    userId: text("user_id")
        .notNull()
        .references(() => users.id, { onDelete: "cascade" }),
    content: text("content").notNull(),
    type: text("type").notNull().default("text"), // 'text' | 'file' | 'system'
    fileId: text("file_id").references(() => files.id, { onDelete: "set null" }),
    replyToId: text("reply_to_id"), // simple reply tracking
    createdAt: integer("created_at").notNull(),
    editedAt: integer("edited_at"),
});
export const reactions = sqliteTable("reactions", {
    id: text("id").primaryKey(),
    messageId: text("message_id")
        .notNull()
        .references(() => messages.id, { onDelete: "cascade" }),
    userId: text("user_id")
        .notNull()
        .references(() => users.id, { onDelete: "cascade" }),
    emoji: text("emoji").notNull(),
    createdAt: integer("created_at").notNull(),
});
export const inviteCodes = sqliteTable("invite_codes", {
    id: text("id").primaryKey(),
    code: text("code").notNull().unique(),
    createdBy: text("created_by")
        .notNull()
        .references(() => users.id, { onDelete: "cascade" }),
    usedBy: text("used_by").references(() => users.id, { onDelete: "set null" }),
    usedAt: integer("used_at"),
    createdAt: integer("created_at").notNull(),
});
