import type { Attachment, Message } from "@snezhok/contracts";

import type { BackgroundGroupDispatch } from "../../transfers/backgroundTransfers";
import { attachmentGroupSize, optimisticMessagesForAttachmentBatch, type AttachmentMessageKind, type QueuedAttachmentBatch } from "../../transfers/backgroundTransferModel";
import type { TransferHandle } from "../../transfers/transferManager";
import type { AppState, AppStoreGet } from "../../store/appState";
import type { UploadInput } from "../../types";

export interface AttachmentTransferDependencies<Guard> {
  get: AppStoreGet;
  captureGuard: () => Guard;
  guardIsCurrent: (guard: Guard) => boolean;
  sessionIsActive: () => boolean;
  createId: () => string;
  transport: Pick<typeof import("../../infrastructure/http/apiClient").api, "upload" | "createMessage" | "cancelUpload">;
  media: {
    prepareOne: typeof import("../../lib/prepareMediaUpload").prepareMediaUpload;
    prepareMany: typeof import("../../lib/prepareMediaUpload").prepareMediaUploads;
  };
  background: {
    available: boolean;
    enqueueBatch: typeof import("../../transfers/backgroundTransfers").enqueueBackgroundAttachmentBatch;
    replaceBatchInputs: typeof import("../../transfers/backgroundTransfers").replaceBackgroundAttachmentBatchInputs;
    resumeBatch: typeof import("../../transfers/backgroundTransfers").resumeBackgroundAttachmentBatch;
    failBatch: typeof import("../../transfers/backgroundTransfers").failBackgroundAttachmentBatch;
    waitForBatch: typeof import("../../transfers/backgroundTransfers").waitForBackgroundBatch;
    cancelBatch: typeof import("../../transfers/backgroundTransfers").cancelBackgroundBatch;
    reconcile: typeof import("../../transfers/backgroundTransfers").reconcileBackgroundTransfers;
    retryForMessage: typeof import("../../transfers/backgroundTransfers").retryBackgroundBatchForMessage;
  };
  manager: Pick<typeof import("../../transfers/transferManager").transferManager,
    "begin" | "cancel" | "cancelWhere" | "clearTerminal">;
}

type AttachmentTransferActions = Pick<AppState,
  "uploadAttachment" | "sendAttachmentBatch" | "reconcileBackgroundTransfers" | "retryAttachmentTransfer" | "cancelUpload">;

export interface AttachmentTransferDomain {
  actions: AttachmentTransferActions;
  cancelAll: () => Promise<void>;
}

export function createAttachmentTransferDomain<Guard>({
  get,
  captureGuard,
  guardIsCurrent,
  sessionIsActive,
  createId,
  transport,
  media,
  background,
  manager,
}: AttachmentTransferDependencies<Guard>): AttachmentTransferDomain {
  const activeBackgroundBatches = new Map<string, TransferHandle>();

  const dispatchBackgroundAttachmentGroup = async ({ batch, input }: BackgroundGroupDispatch): Promise<Message> => {
    if (get().me?.id !== batch.ownerId || !sessionIsActive()) {
      const error = new Error("The active account changed while this transfer was running");
      error.name = "BackgroundTransferPausedError";
      throw error;
    }
    const message = await transport.createMessage(batch.streamId, input);
    if (get().me?.id === batch.ownerId && sessionIsActive()) get().applyMessage(message, "created");
    return message;
  };

  const sendForegroundAttachmentBatch = async (
    streamId: string,
    inputs: UploadInput[],
    messageKind: AttachmentMessageKind,
    replyToId: string | null,
    text: string,
    guard: Guard,
    transfer: TransferHandle,
    transferId: string,
  ) => {
    const groupSize = attachmentGroupSize(messageKind);
    let completed = 0;
    try {
      for (let start = 0; start < inputs.length; start += groupSize) {
        const group = inputs.slice(start, start + groupSize);
        const attachments: Attachment[] = [];
        for (const input of group) {
          const attachment = await transport.upload(input, (progress) => {
            if (!guardIsCurrent(guard)) return;
            const overall = Math.round(((completed + progress / 100) / inputs.length) * 100);
            transfer.updateProgress(Math.max(0, Math.min(100, overall)));
          }, `${transferId}:${completed}`);
          if (!guardIsCurrent(guard)) throw new StaleAccountOperationError();
          attachments.push(attachment);
          completed += 1;
        }
        await get().sendMessage(streamId, {
          text: start === 0 ? text : "",
          kind: messageKind,
          replyToId: start === 0 ? replyToId : null,
          attachmentIds: attachments.map((attachment) => attachment.id),
          silent: false,
        }, attachments);
      }
    } finally {
      // The parent handle owns batch-level progress; child upload handles are
      // created and released by the transport adapter.
    }
  };

  const cancelAll = async () => {
    const batchIds = [...activeBackgroundBatches.keys()];
    await Promise.all([
      transport.cancelUpload(),
      manager.cancelWhere((transfer) => transfer.kind === "background-batch" || transfer.kind === "foreground-upload"),
      ...batchIds.map((batchId) => background.cancelBatch(batchId)),
    ]);
    activeBackgroundBatches.clear();
    manager.clearTerminal();
  };

  const projectPendingBatch = (batch: QueuedAttachmentBatch) => {
    const me = get().me;
    if (!me || me.id !== batch.ownerId) return;
    const current = get().messages[batch.streamId] ?? [];
    const knownClientIds = new Set(current.flatMap((message) => message.clientId ? [message.clientId] : []));
    const startSequence = (current.at(-1)?.sequence ?? 0) + 1;
    for (const optimistic of optimisticMessagesForAttachmentBatch({
      batch,
      sender: me,
      streamKind: get().channels.some((channel) => channel.id === batch.streamId) ? "channel" : "conversation",
      startingSequence: startSequence,
    })) {
      const existing = current.find((message) => message.id === optimistic.id || message.clientId === optimistic.clientId);
      if (existing && !existing.pending && !existing.failed) continue;
      if (!existing && knownClientIds.has(optimistic.clientId ?? "")) continue;
      get().applyMessage(existing ? { ...optimistic, sequence: existing.sequence, createdAt: existing.createdAt } : optimistic, "updated");
    }
  };

  const markBatchFailed = (batch: QueuedAttachmentBatch) => {
    const failedBatch: QueuedAttachmentBatch = {
      ...batch,
      updatedAt: Date.now(),
      transfers: batch.transfers.map((transfer) => transfer.status === "succeeded" ? transfer : { ...transfer, status: "failed", errorCode: transfer.errorCode ?? "transfer_failed" }),
    };
    projectPendingBatch(failedBatch);
  };

  const actions: AttachmentTransferActions = {
    uploadAttachment: async (input, onProgress, transferId) => {
      const guard = captureGuard();
      const preparedInput = await media.prepareOne(input);
      const attachment = await transport.upload(
        { ...preparedInput, stripLocation: preparedInput.stripLocation ?? get().settings.stripMediaLocation },
        (progress) => { if (guardIsCurrent(guard)) onProgress?.(progress); },
        transferId,
      );
      if (!guardIsCurrent(guard)) throw new StaleAccountOperationError();
      return attachment;
    },

    sendAttachmentBatch: (streamId, inputs, messageKind, replyToId, text = "") => {
      const transferId = createId();
      const me = get().me;
      const guard = captureGuard();
      let accept: () => void = () => undefined;
      let rejectAcceptance: (error: unknown) => void = () => undefined;
      const accepted = new Promise<void>((resolve, reject) => { accept = resolve; rejectAcceptance = reject; });
      let projectedBatch: QueuedAttachmentBatch | null = null;
      const completion = (async () => {
        if (!me) {
          const error = new Error("No active session");
          rejectAcceptance(error);
          throw error;
        }
        if (!background.available && !get().online) {
          const error = new Error("Attachments require a network connection on this device");
          rejectAcceptance(error);
          throw error;
        }
        const transfer = manager.begin({
          id: transferId,
          ownerId: me.id,
          kind: background.available ? "background-batch" : "foreground-upload",
        });
        let batchId: string | null = null;
        const removeCancelHandler = transfer.onCancel(async () => {
          await manager.cancelWhere((child) => child.id.startsWith(`${transferId}:`));
          if (batchId) await background.cancelBatch(batchId);
        });
        try {
          transfer.updateProgress(0);
          if (!background.available) {
            const compressed = await media.prepareMany(inputs);
            if (!guardIsCurrent(guard)) throw new StaleAccountOperationError();
            const prepared = compressed.map((input) => ({ ...input, stripLocation: input.stripLocation ?? get().settings.stripMediaLocation }));
            accept();
            await sendForegroundAttachmentBatch(streamId, prepared, messageKind, replyToId, text, guard, transfer, transferId);
          } else {
            batchId = await background.enqueueBatch({
              ownerId: me.id,
              streamId,
              messageKind,
              replyToId,
              text,
              inputs: inputs.map((input) => ({ ...input, stripLocation: input.stripLocation ?? get().settings.stripMediaLocation })),
              deferScheduling: true,
              onCreated: (createdBatch) => {
                batchId = createdBatch.id;
                projectedBatch = createdBatch;
                activeBackgroundBatches.set(createdBatch.id, transfer);
                projectPendingBatch(createdBatch);
              },
            });
            activeBackgroundBatches.set(batchId, transfer);
            accept();
            const compressed = await media.prepareMany(inputs);
            if (!guardIsCurrent(guard)) throw new StaleAccountOperationError();
            const prepared = compressed.map((input) => ({ ...input, stripLocation: input.stripLocation ?? get().settings.stripMediaLocation }));
            await background.replaceBatchInputs(batchId, prepared);
            await background.resumeBatch(batchId);
            await background.waitForBatch({
              batchId,
              ownerId: me.id,
              isOnline: () => get().online,
              isActive: () => guardIsCurrent(guard),
              dispatchGroup: dispatchBackgroundAttachmentGroup,
              onProgress: (progress) => transfer.updateProgress(progress),
            });
          }
          if (!transfer.cancelled) transfer.complete();
        } catch (error) {
          rejectAcceptance(error);
          const paused = error instanceof Error && error.name === "BackgroundTransferPausedError";
          if (!paused && batchId) await background.failBatch(batchId).catch(() => undefined);
          if (!paused && projectedBatch) markBatchFailed(projectedBatch);
          if (!transfer.cancelled) paused ? transfer.complete() : transfer.fail();
          if (paused) return;
          throw error;
        } finally {
          removeCancelHandler();
          if (batchId) activeBackgroundBatches.delete(batchId);
          manager.clearTerminal();
        }
      })();
      return { id: transferId, accepted, completion };
    },

    reconcileBackgroundTransfers: async () => {
      const state = get();
      if (!state.me || state.phase === "signed-out") return;
      const guard = captureGuard();
      await background.reconcile({
        ownerId: state.me.id,
        online: state.online,
        isActive: () => guardIsCurrent(guard),
        dispatchGroup: dispatchBackgroundAttachmentGroup,
        onProgress: (batchId, progress) => {
          if (guardIsCurrent(guard)) activeBackgroundBatches.get(batchId)?.updateProgress(progress);
        },
        onBatch: (batch) => {
          if (guardIsCurrent(guard)) projectPendingBatch(batch);
        },
      });
    },

    retryAttachmentTransfer: async (clientId) => {
      const batch = await background.retryForMessage(clientId);
      if (!batch) return;
      projectPendingBatch(batch);
      if (get().online) await actions.reconcileBackgroundTransfers();
    },

    cancelUpload: async (transferId) => {
      if (!transferId) {
        await cancelAll();
        return;
      }
      await manager.cancel(transferId);
      manager.clearTerminal();
    },
  };

  return { actions, cancelAll };
}

class StaleAccountOperationError extends Error {
  constructor() {
    super("Account changed while the operation was in progress");
    this.name = "StaleAccountOperationError";
  }
}
