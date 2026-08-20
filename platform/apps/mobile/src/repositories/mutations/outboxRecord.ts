import { z } from "zod";

import { messageSchema } from "@snezhok/contracts";

import type { OutboxEntry } from "../../types";

const id = z.string().uuid();
const base = z.object({
  id,
  streamId: id,
  queuedAt: z.number().int().nonnegative(),
  attempts: z.number().int().nonnegative().max(1_000),
  availableAt: z.number().int().nonnegative().optional(),
  dependsOn: z.array(id).max(16).optional(),
});
const createInput = z.object({
  clientId: id,
  text: z.string().max(16_000),
  kind: z.enum(["text", "voice", "video-note", "media", "file"]),
  replyToId: id.nullable(),
  attachmentIds: z.array(id).max(10),
  silent: z.boolean(),
});

export const outboxEntrySchema = z.discriminatedUnion("kind", [
  base.extend({ kind: z.literal("message"), input: createInput }),
  base.extend({ kind: z.literal("forward"), sourceMessageId: id, clientId: id }),
  base.extend({ kind: z.literal("read"), sequence: z.number().int().nonnegative() }),
  base.extend({ kind: z.literal("edit"), messageId: id, text: z.string().min(1).max(16_000), previous: messageSchema }),
  base.extend({ kind: z.literal("delete"), messageId: id, scope: z.enum(["me", "everyone"]), previous: messageSchema }),
  base.extend({ kind: z.literal("pin"), messageId: id, pinned: z.boolean(), previous: messageSchema }),
  base.extend({ kind: z.literal("reaction"), messageId: id, emoji: z.string().min(1).max(32), active: z.boolean(), previous: messageSchema }),
]);

export function decodeOutboxRecords(value: unknown): { entries: OutboxEntry[]; rejected: number } {
  if (!Array.isArray(value)) return { entries: [], rejected: value == null ? 0 : 1 };
  const entries: OutboxEntry[] = [];
  let rejected = 0;
  for (const raw of value) {
    const compatible = raw && typeof raw === "object" && !("kind" in raw) ? { ...raw, kind: "message" } : raw;
    const decoded = outboxEntrySchema.safeParse(compatible);
    if (decoded.success) entries.push(decoded.data as OutboxEntry);
    else rejected += 1;
  }
  return { entries, rejected };
}
