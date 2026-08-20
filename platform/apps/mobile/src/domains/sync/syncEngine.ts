import type { DurableEventEnvelope } from "@snezhok/contracts";

export interface SyncEngineDependencies {
  getCursor: () => number;
  apply: (event: DurableEventEnvelope) => void | Promise<void>;
  commitCursor: (cursor: number) => void;
  recover: (event: DurableEventEnvelope, error: unknown) => void | Promise<void>;
}

/**
 * Serializes durable realtime projection updates and binds cursor advancement
 * to a successful domain write. Socket callbacks must never update the cursor
 * independently: doing so can acknowledge data that the local projection did
 * not actually accept.
 */
export class SyncEngine {
  private tail: Promise<void> = Promise.resolve();

  constructor(private readonly dependencies: SyncEngineDependencies) {}

  accept(event: DurableEventEnvelope): Promise<void> {
    const run = async () => {
      if (event.cursor <= this.dependencies.getCursor()) return;
      try {
        await this.dependencies.apply(event);
      } catch (error) {
        // A successful recovery is a fresh authoritative snapshot and owns its
        // cursor. Never commit the failed envelope's cursor afterward.
        await this.dependencies.recover(event, error);
        return;
      }
      this.dependencies.commitCursor(event.cursor);
    };
    this.tail = this.tail.then(run);
    return this.tail;
  }

  /** A new socket session may retry after a previously failed recovery. */
  resume(): void {
    this.tail = this.tail.catch(() => undefined);
  }

  settled(): Promise<void> {
    return this.tail;
  }
}
