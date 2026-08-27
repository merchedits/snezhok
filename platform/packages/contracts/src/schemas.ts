import { z } from "zod";

export const idSchema = z.string().uuid();
export const cooperativeActivityTypeValues = [
  "question", "blitz", "tiny-quest", "color-hunt", "song-exchange",
  "movie-list", "draw-guess", "ideas-jar", "memory-capsule", "milestone",
  "tic-tac-toe", "chess", "checkers", "sea-battle", "pool",
] as const;
export const cooperativeActivityTypeSchema = z.enum(cooperativeActivityTypeValues);
export const cooperativeActivityActionValues = [
  "submit", "add-item", "update-item", "remove-item", "rate", "set-status",
  "pick", "reroll", "confirm", "submit-drawing", "guess", "complete",
  "decline", "cancel",
  "game-move", "game-ready", "game-shuffle", "game-rematch", "game-resign",
] as const;
export const cooperativeActivityActionSchema = z.enum(cooperativeActivityActionValues);

const boundedActivityPayloadSchema = z.record(z.string().max(80), z.unknown()).default({}).superRefine((value, context) => {
  try {
    if (new TextEncoder().encode(JSON.stringify(value)).byteLength > 64 * 1024) context.addIssue({ code: "custom", message: "Activity payload is too large" });
  } catch {
    context.addIssue({ code: "custom", message: "Activity payload must be JSON serializable" });
  }
});

export const cooperativeActivityCreateSchema = z.object({
  clientId: idSchema,
  type: cooperativeActivityTypeSchema,
  options: boundedActivityPayloadSchema,
});

export const cooperativeActivityCommandSchema = z.object({
  clientId: idSchema,
  expectedRevision: z.number().int().nonnegative(),
  action: cooperativeActivityActionSchema,
  payload: boundedActivityPayloadSchema,
});
export const usernameSchema = z
  .string()
  .trim()
  .min(3, "Username must contain at least 3 characters")
  .max(32, "Username must contain at most 32 characters")
  .regex(/^[a-zA-Z0-9_.-]+$/, "Username may only contain Latin letters, numbers, dots, hyphens and underscores")
  .transform((value) => value.toLowerCase());
export const emailSchema = z.string().trim().max(254, "Email address is too long").toLowerCase().pipe(z.email("Enter a valid email address"));

export const loginSchema = z.object({
  username: usernameSchema,
  password: z.string().min(8, "Password must contain at least 8 characters").max(256, "Password must contain at most 256 characters"),
  deviceName: z.string().trim().min(1).max(80).default("Web browser"),
  platform: z.enum(["web", "android"]).default("web"),
});

export const registerSchema = loginSchema.extend({
  email: emailSchema,
});

export const profileUpdateSchema = z.object({
  displayName: z.string().trim().min(1).max(48).optional(),
  bio: z.string().trim().max(512).optional(),
  statusText: z.string().trim().max(128).optional(),
}).refine((value) => Object.keys(value).length > 0, { message: "At least one profile field is required" });

export const profilePhotoSchema = z.object({ attachmentId: idSchema });
export const profilePhotoOrderSchema = z.object({
  attachmentIds: z.array(idSchema).min(1).max(10),
}).refine((value) => new Set(value.attachmentIds).size === value.attachmentIds.length, {
  message: "Profile photos must be unique",
});

export const messageCreateSchema = z.object({
  clientId: z.string().uuid(),
  text: z.string().max(16_000).default(""),
  kind: z.enum(["text", "voice", "video-note", "media", "file"]).default("text"),
  replyToId: idSchema.nullable().default(null),
  attachmentIds: z.array(idSchema).max(10).default([]),
  silent: z.boolean().default(false),
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
}).refine((value) => new Set(value.participantIds).size === value.participantIds.length, {
  message: "Participants must be unique",
  path: ["participantIds"],
});

export const groupUpdateSchema = z.object({
  title: z.string().trim().min(1).max(80).optional(),
  avatarAttachmentId: idSchema.nullable().optional(),
}).refine((value) => value.title !== undefined || value.avatarAttachmentId !== undefined, {
  message: "At least one group field is required",
});

export const groupMemberSchema = z.object({
  userId: idSchema,
  role: z.enum(["admin", "member"]).default("member"),
});

export const groupMemberRoleSchema = z.object({ role: z.enum(["admin", "member"]) });
export const ownershipTransferSchema = z.object({ userId: idSchema });

export const serverCreateSchema = z.object({
  name: z.string().trim().min(1).max(80),
});

export const serverUpdateSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  iconAttachmentId: idSchema.nullable().optional(),
}).refine((value) => value.name !== undefined || value.iconAttachmentId !== undefined, {
  message: "At least one server field is required",
});

export const channelCreateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  kind: z.enum(["text", "voice"]),
  categoryId: idSchema.nullable().default(null),
  topic: z.string().trim().max(1024).default(""),
});

export const categoryCreateSchema = z.object({
  name: z.string().trim().min(1).max(80),
});

export const channelUpdateSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  topic: z.string().trim().max(1024).optional(),
  categoryId: idSchema.nullable().optional(),
  position: z.number().int().min(0).max(10_000).optional(),
}).refine((value) => Object.values(value).some((item) => item !== undefined), {
  message: "At least one channel field is required",
});

export const categoryUpdateSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  position: z.number().int().min(0).max(10_000).optional(),
}).refine((value) => Object.values(value).some((item) => item !== undefined), {
  message: "At least one category field is required",
});

export const serverPermissionValues = [
  "view_channels", "send_messages", "attach_files", "add_reactions",
  "manage_messages", "connect", "speak", "video", "screen_share",
  "move_members", "manage_channels", "manage_categories", "manage_members",
  "kick_members", "ban_members", "manage_roles", "manage_server", "view_audit_log",
] as const;
export const serverPermissionSchema = z.enum(serverPermissionValues);

const serverRoleNameSchema = z.string().trim().min(1).max(80);
const serverRoleColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable();
const serverPermissionsSchema = z.array(serverPermissionSchema).max(serverPermissionValues.length);

export const channelPermissionOverrideSchema = z.object({
  allow: serverPermissionsSchema.default([]),
  deny: serverPermissionsSchema.default([]),
}).refine((value) => new Set(value.allow).size === value.allow.length && new Set(value.deny).size === value.deny.length, {
  message: "Permissions must be unique",
}).refine((value) => !value.allow.some((permission) => value.deny.includes(permission)), {
  message: "A permission cannot be both allowed and denied",
});

export const serverRoleCreateSchema = z.object({
  name: serverRoleNameSchema,
  color: serverRoleColorSchema.default(null),
  permissions: serverPermissionsSchema.default([]),
}).refine((value) => new Set(value.permissions).size === value.permissions.length, {
  message: "Permissions must be unique",
  path: ["permissions"],
});

// Zod 4 refined objects cannot be made partial. Build both schemas from the
// same unrefined field shape so importing this module never throws.
export const serverRoleUpdateSchema = z.object({
  name: serverRoleNameSchema.optional(),
  color: serverRoleColorSchema.optional(),
  permissions: serverPermissionsSchema.optional(),
  position: z.number().int().min(0).max(10_000).optional(),
}).refine((value) => Object.values(value).some((item) => item !== undefined), {
  message: "At least one role field is required",
});

const serverRoleIdsSchema = z.array(idSchema).max(50).refine((ids) => new Set(ids).size === ids.length, {
  message: "Server roles must be unique",
});

export const serverMemberUpdateSchema = z.object({
  role: z.enum(["admin", "moderator", "member"]).optional(),
  roleIds: serverRoleIdsSchema.optional(),
}).refine((value) => value.role !== undefined || value.roleIds !== undefined, {
  message: "At least one member field is required",
});

export const serverBanSchema = z.object({ reason: z.string().trim().max(512).default("") });

export const markUnreadSchema = z.object({
  sequence: z.number().int().nonnegative().optional(),
});

export const privacySettingsSchema = z.object({
  directMessages: z.enum(["everyone", "contacts", "nobody"]),
  groupInvites: z.enum(["everyone", "contacts", "nobody"]),
  profilePhotos: z.enum(["everyone", "contacts", "nobody"]),
});
export const privacySettingsUpdateSchema = privacySettingsSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  { message: "At least one privacy field is required" },
);

export const accountDeletionSchema = z.object({
  password: z.string().min(8).max(256),
  confirmation: z.literal("DELETE"),
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
