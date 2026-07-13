import { z } from "zod";

export const idSchema = z.string().uuid();
export const usernameSchema = z
  .string()
  .trim()
  .min(3)
  .max(32)
  .regex(/^[a-zA-Z0-9_.-]+$/)
  .transform((value) => value.toLowerCase());
export const emailSchema = z.string().trim().max(254).toLowerCase().pipe(z.email());

export const loginSchema = z.object({
  username: usernameSchema,
  password: z.string().min(8).max(256),
  deviceName: z.string().trim().min(1).max(80).default("Web browser"),
  platform: z.enum(["web", "android"]).default("web"),
});

export const registerSchema = loginSchema.extend({
  email: emailSchema,
});

export const messageCreateSchema = z.object({
  clientId: z.string().uuid(),
  text: z.string().max(16_000).default(""),
  kind: z.enum(["text", "voice", "video-note", "media", "file"]).default("text"),
  replyToId: idSchema.nullable().default(null),
  attachmentIds: z.array(idSchema).max(10).default([]),
}).refine((value) => value.text.trim().length > 0 || value.attachmentIds.length > 0, {
  message: "A message must contain text or an attachment",
});

export const messageEditSchema = z.object({
  text: z.string().trim().min(1).max(16_000),
});

export const reactionSchema = z.object({
  emoji: z.string().min(1).max(32),
});

export const conversationCreateSchema = z.object({
  participantIds: z.array(idSchema).min(1).max(99),
  title: z.string().trim().max(80).optional(),
});

export const serverCreateSchema = z.object({
  name: z.string().trim().min(1).max(80),
});

export const channelCreateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  kind: z.enum(["text", "voice"]),
  categoryId: idSchema.nullable().default(null),
  topic: z.string().trim().max(1024).default(""),
});

export const friendRequestSchema = z.object({
  username: usernameSchema,
});

export const uploadMetadataSchema = z.object({
  quality: z.enum(["data-saver", "auto", "high", "original"]),
  kind: z.enum(["image", "video", "audio", "document"]),
  stripLocation: z.boolean().default(true),
  purpose: z.enum(["standard", "voice", "video-note"]).default("standard"),
});
