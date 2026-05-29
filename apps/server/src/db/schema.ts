import { sqliteTable, text, integer, index, unique } from "drizzle-orm/sqlite-core";
import { relations } from "drizzle-orm";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  displayName: text("display_name").notNull(),
  avatarColor: text("avatar_color").notNull(),
  avatarUrl: text("avatar_url"),
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
}, (table) => {
  return {
    userIdIdx: index("sessions_user_id_idx").on(table.userId),
  };
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
}, (table) => {
  return {
    createdAtIdx: index("messages_created_at_idx").on(table.createdAt),
  };
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
}, (table) => {
  return {
    messageIdIdx: index("reactions_message_id_idx").on(table.messageId),
    uniqueReaction: unique("reactions_message_user_emoji_idx").on(table.messageId, table.userId, table.emoji),
  };
});

// --- Relations ---

export const usersRelations = relations(users, ({ many }) => ({
  messages: many(messages),
  reactions: many(reactions),
  files: many(files),
  sessions: many(sessions),
}));

export const messagesRelations = relations(messages, ({ one, many }) => ({
  user: one(users, {
    fields: [messages.userId],
    references: [users.id],
  }),
  file: one(files, {
    fields: [messages.fileId],
    references: [files.id],
  }),
  reactions: many(reactions),
}));

export const reactionsRelations = relations(reactions, ({ one }) => ({
  message: one(messages, {
    fields: [reactions.messageId],
    references: [messages.id],
  }),
  user: one(users, {
    fields: [reactions.userId],
    references: [users.id],
  }),
}));

export const filesRelations = relations(files, ({ one }) => ({
  user: one(users, {
    fields: [files.userId],
    references: [users.id],
  }),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, {
    fields: [sessions.userId],
    references: [users.id],
  }),
}));

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
