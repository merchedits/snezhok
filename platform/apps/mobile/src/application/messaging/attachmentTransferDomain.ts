import type { Attachment, Message } from "@snezhok/contracts";

import type { BackgroundGroupDispatch } from "../../transfers/backgroundTransfers";
import { attachmentGroupSize, type AttachmentMessageKind } from "../../transfers/backgroundTransferModel";
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
    waitForBatch: typeof import("../../transfers/backgroundTransfers").waitForBackgroundBatch;
    cancelBatch: typeof import("../../transfers/backgroundTransfers").cancelBackgroundBatch;
    reconcile: typeof import("../../transfers/backgroundTransfers").reconcileBackgroundTransfers;
  };
  manager: Pick<typeof import("../../transfers/transferManager").transferManager,
    "begin" | "cancel" | "cancelWhere" | "clearTerminal">;
}

type AttachmentTransferActions = Pick<AppState,
  "uploadAttachment" | "sendAttachmentBatch" | "reconcileBackgroundTransfers" | "cancelUpload">;

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
    const message = await transport.createMessage(batch.streamId, input);
    if (get().me?.id === batch.ownerId && sessionIsActive()) get().applyMessage(message, "created");
    return message;
  };

  const sendForegroundAttachmentBatch = async (
    streamId: string,
    inputs: UploadInput[],
    messageKind: AttachmentMessageKind,
    replyToId: string | null,
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
          text: "",
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

    sendAttachmentBatch: (streamId, inputs, messageKind, replyToId) => {
      const transferId = createId();
      const me = get().me;
      const guard = captureGuard();
      const completion = (async () => {
        if (!me) throw new Error("No active session");
        if (!get().online) throw new Error("Attachments require a network connection");
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
          const compressed = await media.prepareMany(inputs);
          if (!guardIsCurrent(guard)) throw new StaleAccountOperationError();
          const prepared = compressed.map((input) => ({ ...input, stripLocation: input.stripLocation ?? get().settings.stripMediaLocation }));
          if (!background.available) {
            await sendForegroundAttachmentBatch(streamId, prepared, messageKind, replyToId, guard, transfer, transferId);
          } else {
            batchId = await background.enqueueBatch({
              ownerId: me.id,
              streamId,
              messageKind,
              replyToId,
              inputs: prepared,
              onCreated: (createdBatchId) => {
                batchId = createdBatchId;
                activeBackgroundBatches.set(createdBatchId, transfer);
              },
            });
            activeBackgroundBatches.set(batchId, transfer);
            await background.waitForBatch({
              batchId,
              ownerId: me.id,
              isOnline: () => get().online,
              dispatchGroup: dispatchBackgroundAttachmentGroup,
              onProgress: (progress) => transfer.updateProgress(progress),
            });
          }
          if (!transfer.cancelled) transfer.complete();
        } catch (error) {
          if (!transfer.cancelled) transfer.fail();
          throw error;
        } finally {
          removeCancelHandler();
          if (batchId) activeBackgroundBatches.delete(batchId);
          manager.clearTerminal();
        }
      })();
      return { id: transferId, completion };
    },

    reconcileBackgroundTransfers: async () => {
      const state = get();
      if (!state.me || state.phase === "signed-out") return;
      const guard = captureGuard();
      await background.reconcile({
        ownerId: state.me.id,
        online: state.online,
        dispatchGroup: dispatchBackgroundAttachmentGroup,
        onProgress: (batchId, progress) => {
          if (guardIsCurrent(guard)) activeBackgroundBatches.get(batchId)?.updateProgress(progress);
        },
      });
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
