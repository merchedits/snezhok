import type { Message } from "@snezhok/contracts";

import { reconcileMessageVersion } from "../../domains/messaging/messageReconciliation";

export interface MessageRepositoryState {
  byId: Record<string, Message>;
  idsByStream: Record<string, string[]>;
  idByClientId: Record<string, string>;
}

export interface MessageRepositoryProjection {
  repository: MessageRepositoryState;
  messages: Record<string, Message[]>;
}

export const emptyMessageRepository: MessageRepositoryState = {
  byId: {},
  idsByStream: {},
  idByClientId: {},
};

/**
 * Canonicalizes message entities incrementally. Arrays remain a compatibility
 * projection for current screens; repository identity is authoritative.
 */
export function reconcileMessageProjection(
  nextMessages: Record<string, Message[]>,
  previousMessages: Record<string, Message[]>,
  previous: MessageRepositoryState = emptyMessageRepository,
): MessageRepositoryProjection {
  const changedStreams = changedStreamIds(previousMessages, nextMessages);
  if (!changedStreams.length) return { repository: previous, messages: nextMessages };

  const byId = { ...previous.byId };
  const idsByStream = { ...previous.idsByStream };
  const idByClientId = { ...previous.idByClientId };

  for (const streamId of changedStreams) {
    const oldIds = new Set(previous.idsByStream[streamId] ?? previousMessages[streamId]?.map((message) => message.id) ?? []);
    const nextIds: string[] = [];
    for (const incoming of nextMessages[streamId] ?? []) {
      const previousId = incoming.clientId ? previous.idByClientId[incoming.clientId] : undefined;
      const current = previous.byId[incoming.id] ?? (previousId ? previous.byId[previousId] : undefined);
      const canonical = current && current.id === incoming.id ? reconcileMessageVersion(current, incoming) : incoming;
      if (previousId && previousId !== canonical.id) {
        delete byId[previousId];
        oldIds.delete(previousId);
      }
      byId[canonical.id] = canonical;
      nextIds.push(canonical.id);
      oldIds.delete(canonical.id);
      const clientId = canonical.clientId ?? ((canonical.pending || canonical.failed) ? canonical.id : null);
      if (clientId) idByClientId[clientId] = canonical.id;
    }
    for (const removedId of oldIds) {
      const removed = byId[removedId];
      if (removed?.streamId !== streamId) continue;
      delete byId[removedId];
      const clientId = removed.clientId ?? ((removed.pending || removed.failed) ? removed.id : null);
      if (clientId && idByClientId[clientId] === removedId) delete idByClientId[clientId];
    }
    if (nextIds.length) idsByStream[streamId] = nextIds;
    else delete idsByStream[streamId];
  }

  let projectedByStream: Record<string, Message[]> | null = null;
  for (const streamId of changedStreams) {
    const incoming = nextMessages[streamId] ?? [];
    const ids = idsByStream[streamId] ?? [];
    const projected = ids.map((id) => byId[id]!).filter(Boolean);
    if (sameReferences(projected, incoming)) continue;
    projectedByStream ??= { ...nextMessages };
    projectedByStream[streamId] = projected;
  }
  return { repository: { byId, idsByStream, idByClientId }, messages: projectedByStream ?? nextMessages };
}

export function messagesForStream(repository: MessageRepositoryState, streamId: string): readonly Message[] {
  return (repository.idsByStream[streamId] ?? []).map((id) => repository.byId[id]!).filter(Boolean);
}

function changedStreamIds(previous: Record<string, Message[]>, next: Record<string, Message[]>): string[] {
  const ids = new Set([...Object.keys(previous), ...Object.keys(next)]);
  return [...ids].filter((id) => previous[id] !== next[id]);
}

function sameReferences(left: readonly Message[], right: readonly Message[]): boolean {
  return left.length === right.length && left.every((message, index) => message === right[index]);
}
