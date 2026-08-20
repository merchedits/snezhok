import type { BootstrapPayload, Message } from "@snezhok/contracts";

import type { OfflineCacheDelta } from "../../lib/offlineRepository";
import type { OutboxEntry } from "../../types";

export interface PersistenceRequest {
  bootstrap?: boolean;
  outbox?: boolean;
  streamIds?: Iterable<string>;
  removedStreamIds?: Iterable<string>;
  removedMessages?: Iterable<{ streamId: string; messageId: string }>;
}

export interface PersistenceSnapshot {
  bootstrap: BootstrapPayload | null;
  messages: Record<string, Message[]>;
  outbox: OutboxEntry[];
}

export interface AppPersistenceDependencies {
  snapshot: () => PersistenceSnapshot;
  writeCacheDelta: (delta: OfflineCacheDelta) => Promise<void>;
  writeOutbox: (outbox: OutboxEntry[]) => Promise<void>;
  reportFailure: (message: string) => void;
  debounceMs?: number;
  retryMs?: number;
}

/** Owns coalescing and serialization for the account-scoped SQLite projection. */
export class AppPersistenceCoordinator {
  private queue: Promise<void> = Promise.resolve();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private generation = 0;
  private bootstrapDirty = false;
  private outboxDirty = false;
  private readonly streamIds = new Set<string>();
  private readonly removedStreamIds = new Set<string>();
  private readonly removedMessageIds = new Map<string, Set<string>>();

  constructor(private readonly dependencies: AppPersistenceDependencies) {}

  schedule(request: PersistenceRequest): void {
    this.mark(request);
    this.clearTimer();
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush().catch(() => this.dependencies.reportFailure("Offline cache persistence failed"));
    }, this.dependencies.debounceMs ?? 700);
  }

  persist(request: PersistenceRequest): Promise<void> {
    this.mark(request);
    this.clearTimer();
    return this.flush();
  }

  settled(): Promise<void> {
    return this.queue;
  }

  cancel(): void {
    this.generation += 1;
    this.clearTimer();
    this.bootstrapDirty = false;
    this.outboxDirty = false;
    this.streamIds.clear();
    this.removedStreamIds.clear();
    this.removedMessageIds.clear();
  }

  private mark(request: PersistenceRequest): void {
    this.bootstrapDirty ||= Boolean(request.bootstrap);
    this.outboxDirty ||= Boolean(request.outbox);
    for (const streamId of request.streamIds ?? []) {
      if (!this.removedStreamIds.has(streamId)) this.streamIds.add(streamId);
    }
    for (const streamId of request.removedStreamIds ?? []) {
      this.streamIds.delete(streamId);
      this.removedStreamIds.add(streamId);
      this.removedMessageIds.delete(streamId);
    }
    for (const { streamId, messageId } of request.removedMessages ?? []) {
      if (this.removedStreamIds.has(streamId)) continue;
      const ids = this.removedMessageIds.get(streamId) ?? new Set<string>();
      ids.add(messageId);
      this.removedMessageIds.set(streamId, ids);
    }
  }

  private flush(): Promise<void> {
    const writeBootstrap = this.bootstrapDirty;
    const writeOutboxSnapshot = this.outboxDirty;
    const streamIds = [...this.streamIds];
    const removedStreamIds = [...this.removedStreamIds];
    const removedMessageIds = Object.fromEntries([...this.removedMessageIds].map(([streamId, ids]) => [streamId, [...ids]]));
    if (!writeBootstrap && !writeOutboxSnapshot && streamIds.length === 0 && removedStreamIds.length === 0 && Object.keys(removedMessageIds).length === 0) return this.queue;

    this.bootstrapDirty = false;
    this.outboxDirty = false;
    this.streamIds.clear();
    this.removedStreamIds.clear();
    this.removedMessageIds.clear();
    const generation = this.generation;
    const snapshot = this.dependencies.snapshot();
    const delta: OfflineCacheDelta = { cachedAt: Date.now() };
    if (writeBootstrap) delta.bootstrap = snapshot.bootstrap;
    if (streamIds.length) delta.streams = Object.fromEntries(streamIds.map((streamId) => [streamId, snapshot.messages[streamId] ?? []]));
    if (removedStreamIds.length) delta.removedStreamIds = removedStreamIds;
    if (Object.keys(removedMessageIds).length) delta.removedMessageIds = removedMessageIds;
    const retryRequest: PersistenceRequest = {
      ...(writeBootstrap ? { bootstrap: true } : {}),
      ...(writeOutboxSnapshot ? { outbox: true } : {}),
      ...(streamIds.length ? { streamIds } : {}),
      ...(removedStreamIds.length ? { removedStreamIds } : {}),
      ...(Object.keys(removedMessageIds).length ? {
        removedMessages: Object.entries(removedMessageIds).flatMap(([streamId, ids]) => ids.map((messageId) => ({ streamId, messageId }))),
      } : {}),
    };

    this.queue = this.queue.catch(() => undefined).then(async () => {
      await Promise.all([
        writeBootstrap || streamIds.length || removedStreamIds.length || Object.keys(removedMessageIds).length
          ? this.dependencies.writeCacheDelta(delta)
          : Promise.resolve(),
        writeOutboxSnapshot ? this.dependencies.writeOutbox(snapshot.outbox) : Promise.resolve(),
      ]);
    }).catch((error) => {
      if (generation === this.generation) {
        this.mark(retryRequest);
        if (!this.timer) {
          this.timer = setTimeout(() => {
            this.timer = null;
            void this.flush().catch(() => this.dependencies.reportFailure("Offline cache persistence retry failed"));
          }, this.dependencies.retryMs ?? 2_000);
        }
      }
      throw error;
    });
    return this.queue;
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
