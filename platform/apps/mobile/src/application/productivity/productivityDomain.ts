import type { ConversationSummary } from "@snezhok/contracts";

import { acknowledgePendingSettings, hasPendingSettings, mergePendingSettings, type PendingSettingsPatch } from "../../lib/pendingSettings";
import { mergeAcknowledgedPatch } from "../../lib/settingsSync";
import { upsertConversation } from "../../store/conversationIdentity";
import type { AppState, AppStoreGet, AppStoreSet } from "../../store/appState";
import type { PersistenceRequest } from "../../infrastructure/persistence/appPersistenceCoordinator";

interface Dependencies<Guard> {
  set: AppStoreSet;
  get: AppStoreGet;
  persist: (request: PersistenceRequest) => void;
  captureGuard: () => Guard;
  guardIsCurrent: (guard: Guard) => boolean;
  transport: ProductivityTransport;
  storage: ProductivityStorage;
  createId: () => string;
}

export type ProductivityTransport = Pick<typeof import("../../infrastructure/http/apiClient").api,
  "productivity" | "saveDraft" | "scheduleMessage" | "cancelScheduledMessage" |
  "createFolder" | "updateFolder" | "deleteFolder" | "updateConversationPreferences" | "updateSettings">;

export interface ProductivityStorage {
  writeDrafts: (drafts: Record<string, string>) => Promise<void>;
  writeDirtyDraftIds: (ids: readonly string[]) => Promise<void>;
  writePendingSettingsPatch: (patch: PendingSettingsPatch) => Promise<void>;
}

type ProductivityActions = Pick<
  AppState,
  | "refreshProductivity"
  | "setDraft"
  | "scheduleTextMessage"
  | "cancelScheduledMessage"
  | "createFolder"
  | "setFolderMembership"
  | "deleteFolder"
  | "setConversationPreference"
  | "updateSettings"
>;

export interface ProductivityRestoreState {
  pendingSettings: PendingSettingsPatch;
  dirtyDraftIds: readonly string[];
}

export interface ProductivityDomain<Guard> {
  actions: ProductivityActions;
  restore: (state: ProductivityRestoreState) => void;
  pendingSettings: () => PendingSettingsPatch;
  synchronizePendingSettings: (guard: Guard) => Promise<void>;
  reset: () => void;
  settled: () => Promise<void>;
}

/**
 * One owner for debounced drafts, productivity refreshes and settings patches.
 * All timers and serial queues are account-scoped and can be cancelled before
 * local data is cleared, preventing the previous cross-account write races.
 */
export function createProductivityDomain<Guard>({ set, get, persist, captureGuard, guardIsCurrent, transport, storage, createId }: Dependencies<Guard>): ProductivityDomain<Guard> {
  let settingsSyncQueue: Promise<void> = Promise.resolve();
  let settingsPersistenceQueue: Promise<void> = Promise.resolve();
  let draftPersistenceQueue: Promise<void> = Promise.resolve();
  let productivityRefresh: Promise<void> | null = null;
  let lastProductivityCompletedAt = 0;
  let draftPersistenceTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingSettingsPatch: PendingSettingsPatch = {};
  const remoteDraftTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const dirtyDraftIds = new Set<string>();

  const scheduleDraftPersistence = () => {
    if (draftPersistenceTimer) clearTimeout(draftPersistenceTimer);
    draftPersistenceTimer = setTimeout(() => {
      draftPersistenceTimer = null;
      const drafts = get().drafts;
      const dirty = [...dirtyDraftIds];
      draftPersistenceQueue = draftPersistenceQueue
        .catch(() => undefined)
        .then(() => Promise.all([storage.writeDrafts(drafts), storage.writeDirtyDraftIds(dirty)]).then(() => undefined));
    }, 350);
  };

  const persistPendingSettingsPatch = () => {
    const snapshot = { ...pendingSettingsPatch };
    settingsPersistenceQueue = settingsPersistenceQueue
      .catch(() => undefined)
      .then(() => storage.writePendingSettingsPatch(snapshot));
    return settingsPersistenceQueue;
  };

  const synchronizePendingSettings = (guard: Guard): Promise<void> => {
    const operation = settingsSyncQueue.catch(() => undefined).then(async () => {
      if (!guardIsCurrent(guard) || !get().online || !hasPendingSettings(pendingSettingsPatch)) return;
      const requested = { ...pendingSettingsPatch };
      const saved = await transport.updateSettings(requested);
      if (!guardIsCurrent(guard)) return;
      pendingSettingsPatch = acknowledgePendingSettings(pendingSettingsPatch, requested);
      await persistPendingSettingsPatch();
      if (!guardIsCurrent(guard)) return;
      set((state) => ({ settings: mergeAcknowledgedPatch(state.settings, requested, saved) }));
      persist({ bootstrap: true });
    });
    settingsSyncQueue = operation.catch(() => undefined);
    return operation;
  };

  const actions: ProductivityActions = {
    refreshProductivity: () => {
      if (!get().online) return Promise.resolve();
      if (productivityRefresh) return productivityRefresh;
      if (Date.now() - lastProductivityCompletedAt < 30_000) return Promise.resolve();
      const guard = captureGuard();
      productivityRefresh = (async () => {
        const productivity = await transport.productivity();
        if (!guardIsCurrent(guard)) return;
        const remoteDrafts = Object.fromEntries(productivity.drafts.map((draft) => [draft.streamId, draft.text]));
        const localDrafts = get().drafts;
        const dirtyLocalDrafts = Object.entries(localDrafts).filter(([streamId]) => dirtyDraftIds.has(streamId));
        set({
          drafts: { ...remoteDrafts, ...Object.fromEntries(dirtyLocalDrafts) },
          folders: productivity.folders,
          scheduledMessages: productivity.scheduled,
        });
        lastProductivityCompletedAt = Date.now();
        scheduleDraftPersistence();
        await Promise.all(dirtyLocalDrafts.map(async ([streamId, text]) => {
          if (!guardIsCurrent(guard)) return;
          try {
            await transport.saveDraft(streamId, text, null);
            if (guardIsCurrent(guard)) dirtyDraftIds.delete(streamId);
          } catch {
            // Keep the dirty tombstone for the next online reconciliation.
          }
        }));
        if (guardIsCurrent(guard)) scheduleDraftPersistence();
      })().finally(() => { productivityRefresh = null; });
      return productivityRefresh;
    },

    setDraft: (streamId, text) => {
      const guard = captureGuard();
      dirtyDraftIds.add(streamId);
      set((state) => ({ drafts: { ...state.drafts, [streamId]: text } }));
      scheduleDraftPersistence();
      const previous = remoteDraftTimers.get(streamId);
      if (previous) clearTimeout(previous);
      if (get().online) remoteDraftTimers.set(streamId, setTimeout(() => {
        remoteDraftTimers.delete(streamId);
        if (!guardIsCurrent(guard)) return;
        const value = get().drafts[streamId] ?? "";
        void transport.saveDraft(streamId, value, null).then(() => {
          if (!guardIsCurrent(guard)) return;
          if ((get().drafts[streamId] ?? "") === value) dirtyDraftIds.delete(streamId);
          scheduleDraftPersistence();
        }).catch(() => undefined);
      }, 600));
    },

    scheduleTextMessage: async (streamId, partial, scheduledFor) => {
      const guard = captureGuard();
      if (!get().online) throw new Error("Scheduling requires a connection");
      const scheduled = await transport.scheduleMessage(streamId, { ...partial, clientId: createId() }, scheduledFor);
      if (!guardIsCurrent(guard)) return;
      set((state) => ({ scheduledMessages: [...state.scheduledMessages.filter((item) => item.id !== scheduled.id), scheduled].sort((a, b) => a.scheduledFor - b.scheduledFor) }));
    },

    cancelScheduledMessage: async (scheduledMessageId) => {
      const guard = captureGuard();
      if (!get().online) throw new Error("Scheduling requires a connection");
      await transport.cancelScheduledMessage(scheduledMessageId);
      if (!guardIsCurrent(guard)) return;
      set((state) => ({ scheduledMessages: state.scheduledMessages.filter((item) => item.id !== scheduledMessageId) }));
    },

    createFolder: async (name, streams = []) => {
      const guard = captureGuard();
      if (!get().online) throw new Error("Folder changes require a connection");
      const folder = await transport.createFolder(name, streams);
      if (!guardIsCurrent(guard)) return;
      set((state) => ({ folders: [...state.folders.filter((item) => item.id !== folder.id), folder].sort((a, b) => a.position - b.position) }));
    },

    setFolderMembership: async (folder, stream, included) => {
      const guard = captureGuard();
      if (!get().online) throw new Error("Folder changes require a connection");
      const streams = included
        ? [...folder.streams.filter((item) => item.streamId !== stream.streamId || item.streamKind !== stream.streamKind), stream]
        : folder.streams.filter((item) => item.streamId !== stream.streamId || item.streamKind !== stream.streamKind);
      const optimistic = { ...folder, streams };
      set((state) => ({ folders: state.folders.map((item) => item.id === folder.id ? optimistic : item) }));
      try {
        const saved = await transport.updateFolder(folder.id, { streams });
        if (!guardIsCurrent(guard)) return;
        set((state) => ({ folders: state.folders.map((item) => item.id === folder.id ? saved : item) }));
      } catch (error) {
        if (!guardIsCurrent(guard)) return;
        set((state) => ({ folders: state.folders.map((item) => item.id === folder.id ? folder : item) }));
        throw error;
      }
    },

    deleteFolder: async (folderId) => {
      const guard = captureGuard();
      if (!get().online) throw new Error("Folder changes require a connection");
      await transport.deleteFolder(folderId);
      if (!guardIsCurrent(guard)) return;
      set((state) => ({ folders: state.folders.filter((item) => item.id !== folderId) }));
    },

    setConversationPreference: async (conversation, patch) => {
      const guard = captureGuard();
      const optimistic: ConversationSummary = {
        ...conversation,
        pinned: patch.pinned ?? (patch.archived ? false : conversation.pinned),
        archived: patch.archived ?? (patch.pinned ? false : conversation.archived),
        muted: patch.muted ?? conversation.muted,
      };
      set((state) => ({ conversations: upsertConversation(state.conversations, optimistic) }));
      persist({ bootstrap: true });
      if (!get().online) {
        set((state) => ({ conversations: upsertConversation(state.conversations, conversation) }));
        persist({ bootstrap: true });
        throw new Error("Conversation settings require a connection");
      }
      try {
        const saved = await transport.updateConversationPreferences(conversation.id, patch);
        if (!guardIsCurrent(guard)) return;
        set((state) => ({ conversations: upsertConversation(state.conversations, saved) }));
      } catch (error) {
        if (!guardIsCurrent(guard)) return;
        set((state) => ({ conversations: upsertConversation(state.conversations, conversation) }));
        throw error;
      } finally {
        if (guardIsCurrent(guard)) persist({ bootstrap: true });
      }
    },

    updateSettings: async (patch) => {
      const guard = captureGuard();
      const normalizedPatch = { ...patch, ...(Object.prototype.hasOwnProperty.call(patch, "accent") ? { accent: "blue" as const } : {}) };
      set({ settings: { ...get().settings, ...normalizedPatch, accent: "blue" as const } });
      persist({ bootstrap: true });
      pendingSettingsPatch = mergePendingSettings(pendingSettingsPatch, normalizedPatch);
      await persistPendingSettingsPatch();
      if (!guardIsCurrent(guard) || !get().online) return;
      await synchronizePendingSettings(guard);
    },
  };

  return {
    actions,
    restore: (state) => {
      pendingSettingsPatch = { ...state.pendingSettings };
      dirtyDraftIds.clear();
      for (const streamId of state.dirtyDraftIds) dirtyDraftIds.add(streamId);
    },
    pendingSettings: () => ({ ...pendingSettingsPatch }),
    synchronizePendingSettings,
    reset: () => {
      if (draftPersistenceTimer) clearTimeout(draftPersistenceTimer);
      draftPersistenceTimer = null;
      for (const timer of remoteDraftTimers.values()) clearTimeout(timer);
      remoteDraftTimers.clear();
      dirtyDraftIds.clear();
      pendingSettingsPatch = {};
      productivityRefresh = null;
      lastProductivityCompletedAt = 0;
    },
    settled: async () => {
      await Promise.all([
        draftPersistenceQueue.catch(() => undefined),
        settingsPersistenceQueue.catch(() => undefined),
        settingsSyncQueue.catch(() => undefined),
      ]);
    },
  };
}
