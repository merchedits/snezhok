import { z } from "zod";
import { idSchema } from "./schemas.js";
import {
  attachmentLifecycleUpdateSchema,
  categoryEnvelopeSchema,
  channelCategorySchema,
  channelSummarySchema,
  conversationSummarySchema,
  friendEntrySchema,
  messageSchema,
  readCursorSchema,
  serverRoleDefinitionSchema,
  serverSummarySchema,
  timestampSchema,
} from "./runtime.js";

const idEnvelopeSchema = z.object({ id: idSchema });
const serverEntityEnvelopeSchema = z.object({ id: idSchema, serverId: idSchema });
const drawingPointSchema = z.tuple([z.number().finite().min(0).max(300), z.number().finite().min(0).max(240)]);
const drawingStrokesSchema = z.array(z.array(drawingPointSchema).min(2).max(500)).max(200)
  .refine((strokes) => strokes.reduce((total, stroke) => total + stroke.length, 0) <= 2_000, "Drawing has too many points");
export const callUpdateSchema = z.object({
  roomId: idSchema,
  state: z.enum(["started", "ended"]),
  participantIds: z.array(idSchema).max(1_000),
  streamId: idSchema.optional(),
  streamKind: z.enum(["conversation", "channel"]).optional(),
  title: z.string().max(256).optional(),
  callerId: idSchema.optional(),
  callerName: z.string().max(128).optional(),
  startedAt: timestampSchema.optional(),
  endedAt: timestampSchema.optional(),
  answeredByIds: z.array(idSchema).max(1_000).optional(),
  reason: z.enum([
    "ended-by-user", "declined", "room-finished", "stale-timeout", "no-participant-timeout", "permission-changed",
    "account-suspended", "account-deleted", "user-blocked", "member-left", "member-kicked", "member-banned", "channel-deleted",
  ]).optional(),
});

/** Runtime trust boundary for durable events accepted from Socket.IO or replay. */
export const durableServerEventSchemas = {
  "message:created": messageSchema,
  "message:updated": messageSchema,
  "message:deleted": z.object({ id: idSchema, streamId: idSchema, deletedAt: timestampSchema }),
  "attachment:updated": attachmentLifecycleUpdateSchema,
  "conversation:updated": conversationSummarySchema,
  "conversation:removed": idEnvelopeSchema,
  "server:updated": serverSummarySchema,
  "server:removed": idEnvelopeSchema,
  "membership:updated": z.object({ serverId: idSchema, userId: idSchema, state: z.enum(["joined", "updated", "removed"]) }),
  "channel:updated": channelSummarySchema,
  "channel:removed": serverEntityEnvelopeSchema,
  "category:updated": channelCategorySchema,
  "category:removed": serverEntityEnvelopeSchema,
  "server-role:updated": serverRoleDefinitionSchema,
  "server-role:removed": serverEntityEnvelopeSchema,
  "friend:updated": friendEntrySchema,
  "friend:removed": z.object({ userId: idSchema }),
  "presence:updated": z.object({ userId: idSchema, presence: z.enum(["online", "idle", "do-not-disturb", "offline"]), lastSeenAt: timestampSchema }),
  "user:deleted": idEnvelopeSchema,
  "read:updated": readCursorSchema,
  "call:updated": callUpdateSchema,
} as const;

export const durableEventEnvelopeSchema = z.object({
  cursor: z.number().int().positive(),
  name: z.enum(Object.keys(durableServerEventSchemas) as [keyof typeof durableServerEventSchemas, ...(keyof typeof durableServerEventSchemas)[]]),
  payload: z.unknown(),
}).superRefine((event, context) => {
  const decoded = durableServerEventSchemas[event.name].safeParse(event.payload);
  if (!decoded.success) for (const issue of decoded.error.issues) {
    context.addIssue({ ...issue, path: ["payload", ...issue.path] });
  }
});

/** Runtime trust boundary for every event accepted from Socket.IO. */
export const serverEventSchemas = {
  ...durableServerEventSchemas,
  "sync:event": durableEventEnvelopeSchema,
  "sync:ready": z.object({ cursor: z.number().int().nonnegative(), serverTime: timestampSchema }),
  "typing:updated": z.object({ streamId: idSchema, userId: idSchema, typing: z.boolean() }),
  "activity:drawing:updated": z.object({ streamId: idSchema, activityId: idSchema, userId: idSchema, sequence: z.number().int().nonnegative(), strokes: drawingStrokesSchema }),
} as const;
