import { useEffect, useState } from "react";

import { transferManager } from "./transferManager";

/** Narrow UI subscription for one user-visible operation; unrelated uploads never rerender it. */
export function useTransferProgress(transferId: string | null): number | null {
  const [progress, setProgress] = useState<number | null>(transferId ? 0 : null);
  useEffect(() => {
    if (!transferId) {
      setProgress(null);
      return;
    }
    setProgress(0);
    return transferManager.subscribe((snapshots) => {
      const transfer = snapshots.find((snapshot) => snapshot.id === transferId);
      setProgress(transfer?.progress ?? null);
    });
  }, [transferId]);
  return progress;
}
