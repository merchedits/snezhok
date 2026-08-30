import * as Crypto from "expo-crypto";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { api } from "../infrastructure/http/apiClient";
import { recordDiagnostic } from "../diagnostics/diagnostics";
import { clearMediaCache } from "../lib/mediaCache";
import { clearAttachmentDownloads } from "../lib/attachmentDownloadManager";
import { clearLocalData, ensureOfflineOwner, readCache, readCachedMessagePage, readCachedMessagePages, readDirtyDraftIds, readDrafts, readOutbox, readPendingSettingsPatch, writeCacheDelta, writeDirtyDraftIds, writeDrafts, writeOutbox, writePendingSettingsPatch } from "../lib/offlineRepository";
import { clearSession, getRuntimeSession, readSession, sessionOwnerId, subscribeToSessionEvents, writeSession } from "../lib/secureSession";
import { rememberStoredAccount } from "../lib/accountVault";
import { cancelBackgroundBatch, clearBackgroundTransfersForOwner, enqueueBackgroundAttachmentBatch, failBackgroundAttachmentBatch, installBackgroundTransferWakeListener, reconcileBackgroundTransfers, replaceBackgroundAttachmentBatchInputs, resumeBackgroundAttachmentBatch, retryBackgroundBatchForMessage, waitForBackgroundBatch } from "../transfers/backgroundTransfers";
import { backgroundTransferAvailable } from "../../modules/snezhok-background-transfer";
import { prepareMediaUpload, prepareMediaUploads } from "../lib/prepareMediaUpload";
import { transferManager } from "../transfers/transferManager";
import {
  emptyAttachmentRepository,
  reconcileAttachmentProjection,
} from "../repositories/attachments/attachmentRepository";
import {
  emptyMessageRepository,
  reconcileMessageProjection,
} from "../repositories/messages/messageRepository";
import { AppPersistenceCoordinator, type PersistenceRequest } from "../infrastructure/persistence/appPersistenceCoordinator";
import { createMessageQueryDomain } from "../application/messaging/messageQueryActions";
import { createAttachmentTransferDomain } from "../application/messaging/attachmentTransferDomain";
import { createMessageMutationDomain } from "../application/messaging/messageMutationDomain";
import { createActivityMutationActions } from "../application/activities/activityMutationActions";
import { reconcileBootstrapConversations } from "../domains/session/bootstrapReconciliation";
import { createProductivityDomain, type ProductivityDomain } from "../application/productivity/productivityDomain";
import { createRealtimeProjectionActions } from "../application/sync/realtimeProjectionActions";
import { appStateBootstrap, defaultRuntimeCapabilities, defaultSettings, productRuntimeCapabilities, productServerProjection, type AppState, type AppStorePatch } from "./appState";
const appPersistence = new AppPersistenceCoordinator({
  snapshot: () => {
    const state = useAppStore.getState();
    return { bootstrap: appStateBootstrap(state), messages: state.messages, outbox: state.outbox };
  },
  writeCacheDelta,
  writeOutbox,
  reportFailure: (message) => recordDiagnostic("warn", "storage", message),
});
function persistState(request: PersistenceRequest): Promise<void> {
  return appPersistence.persist(request);
}
function schedulePersistence(request: PersistenceRequest): void {
  // Cache I/O is deliberately kept outside navigation and interaction frames.
  // Realtime bursts coalesce into incremental dirty-stream transactions.
  appPersistence.schedule(request);
}
function cancelScheduledPersistence(): void {
  appPersistence.cancel();
}
let bootstrapRefresh: Promise<void> | null = null;
let bootstrapRefreshPending = false;
let lastBootstrapCompletedAt = 0;
let backgroundWakeListenerInstalled = false;
let sessionListenerInstalled = false;
let terminalDataClear: Promise<void> = Promise.resolve();
let accountEpoch = 0;
interface AccountOperationGuard {
  epoch: number;
  userId: string;
}
function captureAccountOperation(): AccountOperationGuard | null {
  const userId = useAppStore.getState().me?.id ?? sessionOwnerId(getRuntimeSession());
  return userId ? { epoch: accountEpoch, userId } : null;
}
function accountOperationIsCurrent(guard: AccountOperationGuard | null): guard is AccountOperationGuard {
  return Boolean(guard
    && guard.epoch === accountEpoch
    && (!useAppStore.getState().me || useAppStore.getState().me?.id === guard.userId)
    && sessionOwnerId(getRuntimeSession()) === guard.userId);
}
function invalidateAccountOperations(): number {
  accountEpoch += 1;
  return accountEpoch;
}
function ensureSessionLossListener(productivityDomain: ProductivityDomain<AccountOperationGuard | null>, resetMutations: () => void): void {
  if (sessionListenerInstalled) return;
  sessionListenerInstalled = true;
  subscribeToSessionEvents((event) => {
    if (getRuntimeSession() || useAppStore.getState().phase === "signed-out") return;
    invalidateAccountOperations();
    cancelScheduledPersistence();
    productivityDomain.reset();
    resetMutations();
    // Stop rendering the authenticated tree before touching SQLite, cached
    // media, or WorkManager. An expired refresh token used to leave the cached
    // inbox mounted while those stores were being cleared, allowing image
    // requests and background reconciliation to race teardown on launch.
    useAppStore.setState({
      phase: "signed-out", error: null, me: null, conversations: [], servers: [], categories: [], channels: [], friends: [],
      messages: {}, drafts: {}, outbox: [], messagePagination: {}, folders: [], scheduledMessages: [], eventCursor: 0,
      capabilities: defaultRuntimeCapabilities, attachmentRepository: emptyAttachmentRepository, messageRepository: emptyMessageRepository,
    });
    terminalDataClear = Promise.allSettled([
      appPersistence.settled(),
      productivityDomain.settled(),
    ]).then(async () => {
      const results = await Promise.allSettled([
        clearLocalData(),
        clearMediaCache(),
        event.preservedStoredAccount || !event.previousOwnerId
          ? Promise.resolve()
          : clearBackgroundTransfersForOwner(event.previousOwnerId),
      ]);
      clearAttachmentDownloads();
      if (results.some((result) => result.status === "rejected")) {
        recordDiagnostic("warn", "storage", "Expired session cleanup was incomplete");
      }
    }).catch(() => {
      // This promise is awaited before the next sign-in. It must never become
      // an unhandled rejection capable of terminating a production JS runtime.
      recordDiagnostic("warn", "storage", "Expired session cleanup was incomplete");
    });
  });
}

export const useAppStore = create<AppState>((setRaw, get) => {
  /**
   * Every message projection crosses this normalization boundary before it is
   * observable. Screens may keep consuming Message[] during the migration,
   * while attachments already have one canonical entity and lifecycle.
   */
  let scheduleOutboxDrain: () => void = () => undefined;
  const set = (update: AppStorePatch): void => {
    let outboxChanged = false;
    setRaw((state) => {
      const patch = typeof update === "function" ? update(state) : update;
      outboxChanged = "outbox" in patch && patch.outbox !== state.outbox;
      if (!("messages" in patch) || patch.messages === state.messages) return patch;
      const normalized = reconcileAttachmentProjection(
        patch.messages,
        state.messages,
        patch.attachmentRepository ?? state.attachmentRepository,
      );
      const canonicalMessages = reconcileMessageProjection(
        normalized.messages,
        state.messages,
        patch.messageRepository ?? state.messageRepository,
      );
      return {
        ...patch,
        messages: canonicalMessages.messages,
        attachmentRepository: normalized.repository,
        messageRepository: canonicalMessages.repository,
      };
    });
    if (outboxChanged) queueMicrotask(scheduleOutboxDrain);
  };
  const messageQueryDomain = createMessageQueryDomain({
    set,
    get,
    persist: schedulePersistence,
    captureGuard: captureAccountOperation,
    guardIsCurrent: accountOperationIsCurrent,
    createId: Crypto.randomUUID,
    transport: api,
    cache: { readPage: readCachedMessagePage, readPages: readCachedMessagePages },
  });
  const attachmentTransferDomain = createAttachmentTransferDomain({
    get,
    captureGuard: captureAccountOperation,
    guardIsCurrent: accountOperationIsCurrent,
    sessionIsActive: () => Boolean(getRuntimeSession()),
    createId: Crypto.randomUUID,
    transport: api,
    media: { prepareOne: prepareMediaUpload, prepareMany: prepareMediaUploads },
    background: {
      available: backgroundTransferAvailable,
      enqueueBatch: enqueueBackgroundAttachmentBatch,
      replaceBatchInputs: replaceBackgroundAttachmentBatchInputs,
      resumeBatch: resumeBackgroundAttachmentBatch,
      failBatch: failBackgroundAttachmentBatch,
      waitForBatch: waitForBackgroundBatch,
      cancelBatch: cancelBackgroundBatch,
      reconcile: reconcileBackgroundTransfers,
      retryForMessage: retryBackgroundBatchForMessage,
    },
    manager: transferManager,
  });
  const messageMutationDomain = createMessageMutationDomain({
    set,
    get,
    persist: schedulePersistence,
    persistNow: persistState,
    captureGuard: captureAccountOperation,
    guardIsCurrent: accountOperationIsCurrent,
    createId: Crypto.randomUUID,
    transport: api,
  });
  scheduleOutboxDrain = messageMutationDomain.scheduleDrain;
  const productivityDomain = createProductivityDomain({
    set,
    get,
    persist: schedulePersistence,
    captureGuard: captureAccountOperation,
    guardIsCurrent: accountOperationIsCurrent,
    transport: api,
    storage: { writeDrafts, writeDirtyDraftIds, writePendingSettingsPatch },
    createId: Crypto.randomUUID,
  });
  const activityMutationActions = createActivityMutationActions({ get, createId: Crypto.randomUUID, transport: api });
  const realtimeProjectionActions = createRealtimeProjectionActions({
    set,
    get,
    persist: schedulePersistence,
    markStreamLoaded: messageQueryDomain.markStreamLoaded,
    forgetStream: messageQueryDomain.forgetStream,
  });

  return ({
  phase: "booting",
  error: null,
  online: true,
  syncing: false,
  eventCursor: 0,
  me: null,
  conversations: [],
  servers: [],
  categories: [],
  channels: [],
  friends: [],
  settings: defaultSettings,
  capabilities: defaultRuntimeCapabilities,
  messages: {},
  attachmentRepository: emptyAttachmentRepository,
  messageRepository: emptyMessageRepository,
  messagePagination: {},
  drafts: {},
  folders: [],
  scheduledMessages: [],
  outbox: [],

  initialize: async () => {
    ensureSessionLossListener(productivityDomain, messageMutationDomain.reset);
    const session = await readSession();
    if (!session) {
      set({ phase: "signed-out", outbox: [] });
      return;
    }
    const ownerId = sessionOwnerId(session);
    if (!ownerId) {
      await Promise.all([clearSession(), clearLocalData()]);
      set({ phase: "signed-out", outbox: [] });
      return;
    }
    await ensureOfflineOwner(ownerId);
    const cache = await readCache();
    const storedSettingsPatch = await readPendingSettingsPatch();
    const [outbox, drafts, dirtyDrafts] = cache.bootstrap
      ? await Promise.all([readOutbox(), readDrafts(), readDirtyDraftIds()])
      : [[], {}, []];
    productivityDomain.restore({ pendingSettings: storedSettingsPatch, dirtyDraftIds: dirtyDrafts });
    ensureBackgroundWakeListener();
    const cached = cache.bootstrap;
    // Never paint private cached screens behind credentials that already need
    // refreshing. If refresh is rejected, those screens would otherwise mount
    // media and tab effects for an account that is being torn down.
    const cachedSessionIsFresh = Boolean(cached && session.expiresAt > Date.now());
    const cachedServers = productServerProjection(cached ?? { servers: [], categories: [], channels: [] });
    set({
      phase: cachedSessionIsFresh ? "ready" : "booting",
      me: cached?.me ?? null,
      conversations: cached?.conversations ?? [],
      ...cachedServers,
      friends: cached?.friends ?? [],
      settings: { ...defaultSettings, ...(cached?.settings ?? {}), ...productivityDomain.pendingSettings(), accent: "blue" },
      capabilities: productRuntimeCapabilities(cached?.capabilities ?? defaultRuntimeCapabilities),
      messages: cache.messages,
      drafts,
      outbox,
      eventCursor: cached?.eventCursor ?? 0,
      messagePagination: Object.fromEntries(Object.keys(cache.messages).map((streamId) => [streamId, { nextCursor: null, initialized: false }])),
    });
    try {
      await get().refreshBootstrap({ force: true });
      await get().refreshProductivity().catch(() => undefined);
      await get().retryOutbox();
      await get().reconcileBackgroundTransfers().catch(() => undefined);
    } catch (error) {
      if (!cached) set({ phase: "error", error: error instanceof Error ? error.message : "Unable to load Snezhok" });
    }
  },

  signIn: async (username, password) => {
    await terminalDataClear;
    const operationEpoch = invalidateAccountOperations();
    messageMutationDomain.reset();
    set({ error: null });
    try {
      const result = await api.login(username.trim(), password);
      if (accountEpoch !== operationEpoch) throw new StaleAccountOperationError();
      await writeSession({
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        expiresAt: Date.now() + result.expiresIn * 1_000,
        ownerId: result.user.id,
      });
      const evictedOwners = await rememberStoredAccount(getRuntimeSession()!, result.user);
      await Promise.all(evictedOwners.map((ownerId) => clearBackgroundTransfersForOwner(ownerId)));
      if (accountEpoch !== operationEpoch) {
        throw new StaleAccountOperationError();
      }
      await ensureOfflineOwner(result.user.id);
      if (accountEpoch !== operationEpoch || !getRuntimeSession()) throw new StaleAccountOperationError();
      set({ me: result.user });
      await get().refreshBootstrap({ force: true });
      await get().refreshProductivity().catch(() => undefined);
      ensureBackgroundWakeListener();
      await get().reconcileBackgroundTransfers().catch(() => undefined);
    } catch (error) {
      if (accountEpoch === operationEpoch) {
        await clearSession();
        set({ phase: "signed-out", error: error instanceof Error ? error.message : "Sign in failed" });
      }
      throw error;
    }
  },

  signUp: async (input) => {
    await terminalDataClear;
    const operationEpoch = invalidateAccountOperations();
    messageMutationDomain.reset();
    set({ error: null });
    try {
      const result = await api.register(input);
      if (accountEpoch !== operationEpoch) throw new StaleAccountOperationError();
      await writeSession({ accessToken: result.accessToken, refreshToken: result.refreshToken, expiresAt: Date.now() + result.expiresIn * 1_000, ownerId: result.user.id });
      const evictedOwners = await rememberStoredAccount(getRuntimeSession()!, result.user);
      await Promise.all(evictedOwners.map((ownerId) => clearBackgroundTransfersForOwner(ownerId)));
      if (accountEpoch !== operationEpoch) {
        throw new StaleAccountOperationError();
      }
      await ensureOfflineOwner(result.user.id);
      if (accountEpoch !== operationEpoch || !getRuntimeSession()) throw new StaleAccountOperationError();
      set({ me: result.user });
      await get().refreshBootstrap({ force: true });
      await get().refreshProductivity().catch(() => undefined);
      ensureBackgroundWakeListener();
      await get().reconcileBackgroundTransfers().catch(() => undefined);
    } catch (error) {
      if (accountEpoch === operationEpoch) {
        await clearSession();
        set({ phase: "signed-out", error: error instanceof Error ? error.message : "Registration failed" });
      }
      throw error;
    }
  },

  clearError: () => set({ error: null }),
  signOut: async () => {
    invalidateAccountOperations();
    cancelScheduledPersistence();
    lastBootstrapCompletedAt = 0;
    bootstrapRefreshPending = false;
    messageQueryDomain.reset();
    productivityDomain.reset();
    messageMutationDomain.reset();
    await Promise.all([appPersistence.settled().catch(() => undefined), productivityDomain.settled()]);
    const session = getRuntimeSession() ?? await readSession();
    const pushInstallationId = await AsyncStorage.getItem("@snezhok/push-installation/v1").catch(() => null);
    if (session) {
      void api.closeDeviceSession(session.accessToken, pushInstallationId).catch((error) => {
        recordDiagnostic("warn", "auth", "Remote device session cleanup failed", { error });
      });
    }
    const ownerId = sessionOwnerId(session);
    void Promise.all([
      attachmentTransferDomain.cancelAll().catch(() => undefined),
      ...(ownerId ? [clearBackgroundTransfersForOwner(ownerId).catch(() => undefined)] : []),
    ]);
    await Promise.all([clearSession(), clearLocalData(), clearMediaCache().catch(() => undefined)]);
    clearAttachmentDownloads();
    set({
      phase: "signed-out",
      error: null,
      me: null,
      conversations: [],
      servers: [],
      categories: [],
      channels: [],
      friends: [],
      settings: defaultSettings,
      capabilities: defaultRuntimeCapabilities,
      messages: {},
      messagePagination: {},
      drafts: {},
      folders: [],
      scheduledMessages: [],
      outbox: [],
      eventCursor: 0,
    });
  },

  setOnline: (online) => {
    if (get().online === online) return;
    set({ online });
    if (online) {
      void get().refreshBootstrap({ force: true, silent: true });
      void get().refreshProductivity().catch(() => undefined);
      void get().retryOutbox();
      void get().reconcileBackgroundTransfers().catch(() => undefined);
    }
  },

  refreshBootstrap: (options = {}) => {
    if (!get().online) return Promise.resolve();
    if (bootstrapRefresh) {
      if (options.force) bootstrapRefreshPending = true;
      return bootstrapRefresh;
    }
    if (!options.force && Date.now() - lastBootstrapCompletedAt < 30_000) return Promise.resolve();
    if (!options.silent) set({ syncing: true });
    const guard = captureAccountOperation();
    bootstrapRefresh = (async () => {
      try {
        const payload = await api.bootstrap();
        if (!accountOperationIsCurrent(guard)) return;
        await ensureOfflineOwner(payload.me.id);
        if (!accountOperationIsCurrent(guard)) return;
        const serverProjection = productServerProjection(payload);
        set((state) => ({
          phase: "ready",
          error: null,
          syncing: false,
          me: payload.me,
          conversations: reconcileBootstrapConversations(state, payload.conversations),
          servers: serverProjection.servers,
          categories: serverProjection.categories,
          channels: serverProjection.channels.map((channel) => state.outbox.some((entry) => entry.kind === "read" && entry.streamId === channel.id)
            ? { ...channel, unreadCount: 0, mentionCount: 0 }
            : channel),
          friends: payload.friends,
          settings: { ...payload.settings, ...productivityDomain.pendingSettings(), accent: "blue" },
          capabilities: productRuntimeCapabilities(payload.capabilities ?? defaultRuntimeCapabilities),
          eventCursor: payload.eventCursor,
        }));
        lastBootstrapCompletedAt = Date.now();
        schedulePersistence({ bootstrap: true });
        await productivityDomain.synchronizePendingSettings(guard).catch(() => undefined);
      } catch (error) {
        if (!accountOperationIsCurrent(guard)) return;
        set({ syncing: false });
        const session = await readSession();
        if (!session) {
          cancelScheduledPersistence();
          await clearLocalData();
          set({ phase: "signed-out", me: null, conversations: [], servers: [], categories: [], channels: [], friends: [], messages: {}, drafts: {}, outbox: [], messagePagination: {} });
        }
        throw error;
      }
    })().finally(() => {
      bootstrapRefresh = null;
      if (bootstrapRefreshPending && accountOperationIsCurrent(guard)) {
        bootstrapRefreshPending = false;
        void get().refreshBootstrap({ force: true, silent: true }).catch(() => undefined);
      }
    });
    return bootstrapRefresh;
  },

  ...productivityDomain.actions,
  ...messageQueryDomain.actions,
  ...attachmentTransferDomain.actions,
  ...messageMutationDomain.actions,
  ...activityMutationActions,

  ...realtimeProjectionActions,

  deleteConversation: async (conversationId) => {
    const guard = captureAccountOperation();
    if (!get().online) throw new Error("Deleting a chat requires a connection");
    await api.deleteConversation(conversationId);
    if (!accountOperationIsCurrent(guard)) return;
    get().removeConversation(conversationId);
  },

  setEventCursor: (cursor) => {
    set((state) => ({ eventCursor: Math.max(state.eventCursor, cursor) }));
    schedulePersistence({ bootstrap: true });
  },
  });
});

function ensureBackgroundWakeListener(): void {
  if (backgroundWakeListenerInstalled) return;
  backgroundWakeListenerInstalled = true;
  installBackgroundTransferWakeListener(() => {
    const state = useAppStore.getState();
    if (state.phase !== "ready" || !state.me) return;
    void state.reconcileBackgroundTransfers().catch((error: unknown) => recordDiagnostic(
      "warn", "media", "Background transfer reconciliation failed", { errorName: error instanceof Error ? error.name : "UnknownError" },
    ));
  });
}

class StaleAccountOperationError extends Error {
  constructor() {
    super("Account changed while the operation was in progress");
    this.name = "StaleAccountOperationError";
  }
}
