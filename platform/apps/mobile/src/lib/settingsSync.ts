/**
 * Applies a server acknowledgement only when the local value still matches
 * the request that produced it. A newer tap therefore cannot be overwritten
 * by an older network response arriving later.
 */
export function mergeAcknowledgedPatch<T extends object>(current: T, requested: Partial<T>, saved: T): T {
  const next = { ...current };
  for (const key of Object.keys(requested) as Array<keyof T>) {
    if (Object.is(current[key], requested[key])) next[key] = saved[key];
  }
  return next;
}

/** Rolls back only values which have not already been replaced by a newer tap. */
export function rollbackRejectedPatch<T extends object>(current: T, requested: Partial<T>, previous: T): T {
  const next = { ...current };
  for (const key of Object.keys(requested) as Array<keyof T>) {
    if (Object.is(current[key], requested[key])) next[key] = previous[key];
  }
  return next;
}
