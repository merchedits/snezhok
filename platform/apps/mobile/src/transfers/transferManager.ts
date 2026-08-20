export type TransferKind = "foreground-upload" | "background-batch" | "update-download";
export type TransferStatus = "running" | "completed" | "failed" | "cancelled";

export interface TransferSnapshot {
  id: string;
  ownerId: string;
  kind: TransferKind;
  progress: number;
  status: TransferStatus;
  createdAt: number;
  updatedAt: number;
}

type CancelHandler = () => void | Promise<void>;
type Listener = (snapshots: readonly TransferSnapshot[]) => void;

export interface TransferHandle {
  readonly id: string;
  readonly cancelled: boolean;
  updateProgress(progress: number): void;
  onCancel(handler: CancelHandler): () => void;
  complete(): void;
  fail(): void;
}

interface ManagedTransfer extends TransferSnapshot {
  cancelHandlers: Set<CancelHandler>;
}

/**
 * Process-level coordinator for user-visible transfer operations. Native
 * WorkManager/SQLite remains the durable owner of background bytes; this class
 * owns concurrent UI cancellation and progress without a global singleton job.
 */
export class TransferManager {
  private readonly transfers = new Map<string, ManagedTransfer>();
  private readonly listeners = new Set<Listener>();

  begin(input: { id: string; ownerId: string; kind: TransferKind; progress?: number }): TransferHandle {
    if (this.transfers.has(input.id)) throw new Error(`Transfer ${input.id} is already active`);
    const now = Date.now();
    const managed: ManagedTransfer = {
      id: input.id, ownerId: input.ownerId, kind: input.kind,
      progress: boundedProgress(input.progress ?? 0), status: "running", createdAt: now, updatedAt: now,
      cancelHandlers: new Set(),
    };
    this.transfers.set(managed.id, managed);
    this.emit();
    return {
      id: managed.id,
      get cancelled() { return managed.status === "cancelled"; },
      updateProgress: (progress) => this.transition(managed.id, { progress: boundedProgress(progress) }),
      onCancel: (handler) => {
        if (managed.status === "cancelled") void handler();
        else managed.cancelHandlers.add(handler);
        return () => managed.cancelHandlers.delete(handler);
      },
      complete: () => this.finish(managed.id, "completed"),
      fail: () => this.finish(managed.id, "failed"),
    };
  }

  snapshots(): readonly TransferSnapshot[] {
    return [...this.transfers.values()].map(({ cancelHandlers: _handlers, ...snapshot }) => snapshot);
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.snapshots());
    return () => this.listeners.delete(listener);
  }

  async cancel(id: string): Promise<boolean> {
    const transfer = this.transfers.get(id);
    if (!transfer || transfer.status !== "running") return false;
    transfer.status = "cancelled";
    transfer.updatedAt = Date.now();
    const handlers = [...transfer.cancelHandlers];
    transfer.cancelHandlers.clear();
    this.emit();
    await Promise.allSettled(handlers.map((handler) => handler()));
    return true;
  }

  async cancelWhere(predicate: (snapshot: TransferSnapshot) => boolean): Promise<number> {
    const ids = this.snapshots().filter((snapshot) => snapshot.status === "running" && predicate(snapshot)).map((snapshot) => snapshot.id);
    await Promise.all(ids.map((id) => this.cancel(id)));
    return ids.length;
  }

  clearTerminal(): void {
    let changed = false;
    for (const [id, transfer] of this.transfers) {
      if (transfer.status === "running") continue;
      this.transfers.delete(id);
      changed = true;
    }
    if (changed) this.emit();
  }

  private finish(id: string, status: "completed" | "failed"): void {
    const transfer = this.transfers.get(id);
    if (!transfer || transfer.status !== "running") return;
    transfer.status = status;
    transfer.progress = status === "completed" ? 100 : transfer.progress;
    transfer.updatedAt = Date.now();
    transfer.cancelHandlers.clear();
    this.emit();
  }

  private transition(id: string, patch: { progress: number }): void {
    const transfer = this.transfers.get(id);
    if (!transfer || transfer.status !== "running" || patch.progress < transfer.progress) return;
    transfer.progress = patch.progress;
    transfer.updatedAt = Date.now();
    this.emit();
  }

  private emit(): void {
    const snapshots = this.snapshots();
    for (const listener of this.listeners) listener(snapshots);
  }
}

export const transferManager = new TransferManager();

function boundedProgress(value: number): number {
  return Math.max(0, Math.min(100, Math.round(Number.isFinite(value) ? value : 0)));
}
