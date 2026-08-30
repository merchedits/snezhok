import type { Attachment, CooperativeActivityEntry, Message } from "@snezhok/contracts";

export interface AttachmentRepositoryState {
  byId: Record<string, Attachment>;
  /** Reverse references make one lifecycle update proportional to its uses. */
  messageIdsByAttachmentId: Record<string, string[]>;
  streamIdByMessageId: Record<string, string>;
}

export interface NormalizedAttachmentProjection {
  repository: AttachmentRepositoryState;
  messages: Record<string, Message[]>;
}

export const emptyAttachmentRepository: AttachmentRepositoryState = {
  byId: {},
  messageIdsByAttachmentId: {},
  streamIdByMessageId: {},
};

/** Builds a repository from an untrusted/cache projection. */
export function normalizeAttachmentProjection(
  messagesByStream: Record<string, Message[]>,
  previous: AttachmentRepositoryState = emptyAttachmentRepository,
): NormalizedAttachmentProjection {
  return reconcileAttachmentProjection(messagesByStream, {}, previous);
}

/**
 * Incrementally normalizes changed streams. An attachment shared by a forward
 * or activity is still one entity, but a routine single-message event does not
 * scan every cached chat.
 */
export function reconcileAttachmentProjection(
  nextMessages: Record<string, Message[]>,
  previousMessages: Record<string, Message[]>,
  previous: AttachmentRepositoryState = emptyAttachmentRepository,
): NormalizedAttachmentProjection {
  const changedStreams = changedStreamIds(previousMessages, nextMessages);
  if (!changedStreams.length) return { repository: previous, messages: nextMessages };

  const byId = { ...previous.byId };
  const streamIdByMessageId = { ...previous.streamIdByMessageId };
  const references = new Map<string, Set<string>>(
    Object.entries(previous.messageIdsByAttachmentId).map(([id, messageIds]) => [id, new Set(messageIds)]),
  );
  const changedAttachmentIds = new Set<string>();

  for (const streamId of changedStreams) {
    for (const message of previousMessages[streamId] ?? []) {
      forEachMessageAttachment(message, (attachment) => references.get(attachment.id)?.delete(message.id));
      delete streamIdByMessageId[message.id];
    }
  }
  for (const streamId of changedStreams) {
    for (const message of nextMessages[streamId] ?? []) {
      streamIdByMessageId[message.id] = streamId;
      forEachMessageAttachment(message, (attachment) => {
        const canonical = chooseCanonical(byId[attachment.id], attachment);
        if (canonical !== byId[attachment.id]) {
          byId[attachment.id] = canonical;
          changedAttachmentIds.add(attachment.id);
        }
        const messageIds = references.get(attachment.id) ?? new Set<string>();
        messageIds.add(message.id);
        references.set(attachment.id, messageIds);
      });
    }
  }

  for (const [attachmentId, messageIds] of references) {
    if (messageIds.size) continue;
    references.delete(attachmentId);
    delete byId[attachmentId];
  }

  const affectedStreams = new Set(changedStreams);
  for (const attachmentId of changedAttachmentIds) {
    for (const messageId of references.get(attachmentId) ?? []) {
      const streamId = streamIdByMessageId[messageId];
      if (streamId) affectedStreams.add(streamId);
    }
  }

  let projectedByStream: Record<string, Message[]> | null = null;
  for (const streamId of affectedStreams) {
    const messages = nextMessages[streamId] ?? [];
    const projected = mapIfChanged(messages, (message) => projectMessage(message, byId));
    if (projected === messages) continue;
    projectedByStream ??= { ...nextMessages };
    projectedByStream[streamId] = projected;
  }
  return {
    repository: {
      byId,
      messageIdsByAttachmentId: Object.fromEntries([...references].map(([id, messageIds]) => [id, [...messageIds]])),
      streamIdByMessageId,
    },
    messages: projectedByStream ?? nextMessages,
  };
}

function changedStreamIds(previous: Record<string, Message[]>, next: Record<string, Message[]>): string[] {
  const ids = new Set([...Object.keys(previous), ...Object.keys(next)]);
  return [...ids].filter((id) => previous[id] !== next[id]);
}

function chooseCanonical(current: Attachment | undefined, incoming: Attachment): Attachment {
  if (!current) return incoming;
  const currentVersion = current.updatedAt ?? 0;
  const incomingVersion = incoming.updatedAt ?? 0;
  const preferred = incomingVersion !== currentVersion
    ? incomingVersion > currentVersion ? incoming : current
    : attachmentCompleteness(incoming) > attachmentCompleteness(current) ? incoming : current;
  const fallback = preferred === incoming ? current : incoming;
  if (preferred.kind !== "audio") return preferred;
  return {
    ...preferred,
    durationMs: preferred.durationMs ?? fallback.durationMs,
    waveform: preferred.waveform?.length ? preferred.waveform : fallback.waveform ?? null,
  };
}

function attachmentCompleteness(attachment: Attachment): number {
  return (attachment.status === "ready" ? 16 : attachment.status === "failed" ? 8 : 0)
    + (attachment.width && attachment.height ? 4 : 0)
    + (attachment.durationMs ? 2 : 0)
    + (attachment.primaryChecksum ? 2 : 0)
    + (attachment.thumbnailUrl ? 1 : 0)
    + (attachment.waveform?.length ? 1 : 0);
}

function projectMessage(message: Message, canonical: Record<string, Attachment>): Message {
  const attachments = mapIfChanged(message.attachments, (attachment) => canonical[attachment.id] ?? attachment);
  const activity = message.activity;
  if (!activity) return attachments === message.attachments ? message : { ...message, attachments };
  const entries = mapIfChanged(activity.entries, (entry) => projectEntry(entry, canonical));
  if (attachments === message.attachments && entries === activity.entries) return message;
  return { ...message, attachments, activity: entries === activity.entries ? activity : { ...activity, entries } };
}

function projectEntry(entry: CooperativeActivityEntry, canonical: Record<string, Attachment>): CooperativeActivityEntry {
  const attachments = mapIfChanged(entry.attachments, (attachment) => canonical[attachment.id] ?? attachment);
  return attachments === entry.attachments ? entry : { ...entry, attachments };
}

function forEachMessageAttachment(message: Message, visit: (attachment: Attachment) => void): void {
  for (const attachment of message.attachments) visit(attachment);
  for (const entry of message.activity?.entries ?? []) for (const attachment of entry.attachments) visit(attachment);
}

function mapIfChanged<T>(items: readonly T[], transform: (item: T) => T): T[] {
  let next: T[] | null = null;
  for (let index = 0; index < items.length; index += 1) {
    const current = items[index]!;
    const projected = transform(current);
    if (!next && projected !== current) next = items.slice(0, index);
    next?.push(projected);
  }
  return next ?? (items as T[]);
}
