import type { Attachment, AttachmentLifecycleUpdate, CooperativeActivityEntry, Message } from "@snezhok/contracts";

export interface AttachmentProjectionResult {
  messages: Record<string, Message[]>;
  changedStreamIds: string[];
}

/**
 * Transitional projection adapter for the legacy Message[] view model.
 * Attachment lifecycle is authoritative by attachment id and updatedAt; a
 * worker completion patches every visible reference without remounting a chat.
 * The repository boundary lets the UI migrate to id-only entities in slices.
 */
export function applyAttachmentLifecycleToMessages(
  messagesByStream: Record<string, Message[]>,
  update: AttachmentLifecycleUpdate,
): AttachmentProjectionResult {
  let nextMessages: Record<string, Message[]> | null = null;
  const changedStreamIds: string[] = [];

  for (const [streamId, messages] of Object.entries(messagesByStream)) {
    const projected = mapIfChanged(messages, (message) => projectMessage(message, update));
    if (projected === messages) continue;
    nextMessages ??= { ...messagesByStream };
    nextMessages[streamId] = projected;
    changedStreamIds.push(streamId);
  }

  return { messages: nextMessages ?? messagesByStream, changedStreamIds };
}

function projectMessage(message: Message, update: AttachmentLifecycleUpdate): Message {
  const attachments = mapIfChanged(message.attachments, (attachment) => projectAttachment(attachment, update));
  const activity = message.activity;
  if (!activity) return attachments === message.attachments ? message : { ...message, attachments };

  const entries = mapIfChanged(activity.entries, (entry) => projectEntry(entry, update));
  if (attachments === message.attachments && entries === activity.entries) return message;
  return { ...message, attachments, activity: entries === activity.entries ? activity : { ...activity, entries } };
}

function projectEntry(entry: CooperativeActivityEntry, update: AttachmentLifecycleUpdate): CooperativeActivityEntry {
  const attachments = mapIfChanged(entry.attachments, (attachment) => projectAttachment(attachment, update));
  return attachments === entry.attachments ? entry : { ...entry, attachments };
}

function projectAttachment(attachment: Attachment, update: AttachmentLifecycleUpdate): Attachment {
  if (attachment.id !== update.id || (attachment.updatedAt ?? 0) > update.updatedAt) return attachment;
  if (update.attachment) return update.attachment;
  if (attachment.status === update.status && attachment.updatedAt === update.updatedAt) return attachment;
  return { ...attachment, status: update.status, updatedAt: update.updatedAt };
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
