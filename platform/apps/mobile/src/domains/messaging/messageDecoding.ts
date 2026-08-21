import {
  cooperativeActivitySchema,
  messagePreviewSchema,
  messageSchema,
  reactionSummarySchema,
  type Attachment,
  type Message,
} from "@snezhok/contracts";

const attachmentKinds = new Set<Attachment["kind"]>(["image", "video", "audio", "document"]);
const qualities = new Set<Attachment["quality"]>(["data-saver", "auto", "high", "original"]);
const statuses = new Set(["processing", "ready", "failed"] as const);

export interface MessageDecodeSummary {
  messages: Message[];
  rejectedMessages: number;
  repairedMessages: number;
  rejectedAttachments: number;
}

interface DecodedMessage {
  message: Message | null;
  repaired: boolean;
  rejectedAttachments: number;
}

/**
 * Runtime decoder for untrusted HTTP, realtime and SQLite message records.
 * Nested user media is repaired or isolated before the strict shared schema is
 * evaluated, so one legacy attachment cannot reject an otherwise valid page.
 */
export function decodeMessageValue(value: unknown): DecodedMessage {
  const canonical = messageSchema.safeParse(value);
  if (!isRecord(value)) return { message: null, repaired: false, rejectedAttachments: 0 };

  const senderId = isRecord(value.sender) && typeof value.sender.id === "string" ? value.sender.id : null;
  const rawAttachments = Array.isArray(value.attachments) ? value.attachments : [];
  const attachments = rawAttachments.flatMap((attachment): Attachment[] => {
    const decoded = decodeAttachmentValue(attachment, senderId);
    return decoded ? [decoded] : [];
  });
  if (canonical.success
    && attachments.length === rawAttachments.length
    && attachments.every((attachment, index) => attachment === rawAttachments[index])) {
    return { message: value as unknown as Message, repaired: false, rejectedAttachments: 0 };
  }
  const reactions = (Array.isArray(value.reactions) ? value.reactions : []).flatMap((reaction) => {
    const decoded = reactionSummarySchema.safeParse(reaction);
    return decoded.success ? [decoded.data] : [];
  });
  const replyTo = value.replyTo == null ? null : safeNested(messagePreviewSchema, value.replyTo);
  const forwardedFrom = value.forwardedFrom == null ? null : safeNested(messagePreviewSchema, value.forwardedFrom);
  const activity = value.activity == null ? null : safeNested(cooperativeActivitySchema, value.activity);
  const repaired = messageSchema.safeParse({
    ...value,
    attachments,
    reactions,
    replyTo,
    forwardedFrom,
    activity,
  });
  return {
    message: repaired.success ? repaired.data as Message : null,
    repaired: repaired.success,
    rejectedAttachments: Math.max(0, rawAttachments.length - attachments.length),
  };
}

export function decodeMessageList(value: unknown, maximum = 1_000): MessageDecodeSummary {
  if (!Array.isArray(value)) return { messages: [], rejectedMessages: 0, repairedMessages: 0, rejectedAttachments: 0 };
  const messages: Message[] = [];
  let rejectedMessages = 0;
  let repairedMessages = 0;
  let rejectedAttachments = 0;
  for (const item of value.slice(0, Math.max(0, maximum))) {
    const decoded = decodeMessageValue(item);
    rejectedAttachments += decoded.rejectedAttachments;
    if (!decoded.message) {
      rejectedMessages += 1;
      continue;
    }
    if (decoded.repaired) repairedMessages += 1;
    messages.push(decoded.message);
  }
  return { messages, rejectedMessages, repairedMessages, rejectedAttachments };
}

export function decodeAttachmentValue(value: unknown, fallbackOwnerId: string | null = null): Attachment | null {
  if (!isRecord(value) || typeof value.id !== "string" || !value.id || typeof value.kind !== "string" || !attachmentKinds.has(value.kind as Attachment["kind"])) return null;

  // Keep reference identity for already-normalized entities. Besides avoiding
  // FlashList row churn, this also enforces HTTPS more narrowly than the wire
  // schema (which remains shared with local development environments).
  if (completeAttachment(value) && mediaUrl(value.url)) return value as unknown as Attachment;
  // A complete transport object with an empty URL is corrupt, not a legacy
  // sparse object. Dropping it lets attachment lifecycle reconciliation repair
  // the entity instead of rendering a knowingly broken native source.
  if (completeAttachmentExceptUrl(value) && value.url === "") return null;

  const kind = value.kind as Attachment["kind"];
  const ownerId = typeof value.ownerId === "string" && value.ownerId ? value.ownerId : fallbackOwnerId;
  if (!ownerId) return null;
  const safeUrl = mediaUrl(value.url) ?? `/api/v1/files/${encodeURIComponent(value.id)}`;
  const candidate = {
    id: value.id,
    ownerId,
    kind,
    filename: boundedText(value.filename, fallbackFilename(kind), 1_024),
    mimeType: boundedText(value.mimeType, fallbackMimeType(kind), 255),
    bytes: nonnegativeNumber(value.bytes, 0),
    width: positiveIntegerOrNull(value.width),
    height: positiveIntegerOrNull(value.height),
    durationMs: nonnegativeNumberOrNull(value.durationMs),
    quality: typeof value.quality === "string" && qualities.has(value.quality as Attachment["quality"]) ? value.quality : "auto",
    url: safeUrl,
    ...(mediaUrl(value.originalUrl) ? { originalUrl: mediaUrl(value.originalUrl)! } : {}),
    thumbnailUrl: mediaUrl(value.thumbnailUrl),
    checksum: boundedText(value.checksum, "unknown", 256),
    ...(typeof value.primaryChecksum === "string" && value.primaryChecksum ? { primaryChecksum: value.primaryChecksum.slice(0, 256) } : {}),
    ...(Array.isArray(value.waveform) ? { waveform: value.waveform.filter((sample): sample is number => typeof sample === "number" && Number.isFinite(sample)).slice(0, 4_096).map((sample) => Math.max(0, Math.min(1, sample))) } : {}),
    ...(typeof value.status === "string" && statuses.has(value.status as "processing" | "ready" | "failed") ? { status: value.status } : {}),
    ...(typeof value.updatedAt === "number" && Number.isFinite(value.updatedAt) && value.updatedAt >= 0 ? { updatedAt: value.updatedAt } : {}),
  };
  return candidate as Attachment;
}

function completeAttachment(value: Record<string, unknown>): boolean {
  return completeAttachmentExceptUrl(value)
    && Boolean(mediaUrl(value.url))
    && (value.originalUrl === undefined || Boolean(mediaUrl(value.originalUrl)))
    && (value.thumbnailUrl === null || Boolean(mediaUrl(value.thumbnailUrl)));
}

function completeAttachmentExceptUrl(value: Record<string, unknown>): boolean {
  return typeof value.ownerId === "string" && Boolean(value.ownerId)
    && typeof value.filename === "string" && Boolean(value.filename)
    && typeof value.mimeType === "string" && Boolean(value.mimeType)
    && typeof value.bytes === "number" && Number.isFinite(value.bytes) && value.bytes >= 0
    && dimension(value.width) && dimension(value.height)
    && (value.durationMs === null || (typeof value.durationMs === "number" && Number.isFinite(value.durationMs) && value.durationMs >= 0))
    && typeof value.quality === "string" && qualities.has(value.quality as Attachment["quality"])
    && typeof value.checksum === "string" && Boolean(value.checksum);
}

function dimension(value: unknown): boolean {
  return value === null || (typeof value === "number" && Number.isInteger(value) && value > 0);
}

function safeNested<T>(schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } }, value: unknown): T | null {
  const decoded = schema.safeParse(value);
  return decoded.success ? decoded.data : null;
}

function mediaUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length < 1 || value.length > 4_096) return null;
  if (value.startsWith("/api/v1/files/")) return value;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" ? value : null;
  } catch {
    return null;
  }
}

function boundedText(value: unknown, fallback: string, maximum: number): string {
  return typeof value === "string" && value.trim() ? value.slice(0, maximum) : fallback;
}

function nonnegativeNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback;
}

function nonnegativeNumberOrNull(value: unknown): number | null {
  return value == null ? null : nonnegativeNumber(value, 0);
}

function positiveIntegerOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? Math.min(value, 100_000) : null;
}

function fallbackFilename(kind: Attachment["kind"]): string {
  return kind === "image" ? "photo.jpg" : kind === "video" ? "video.mp4" : kind === "audio" ? "voice.m4a" : "attachment.bin";
}

function fallbackMimeType(kind: Attachment["kind"]): string {
  return kind === "image" ? "image/jpeg" : kind === "video" ? "video/mp4" : kind === "audio" ? "audio/mp4" : "application/octet-stream";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
