export const bootstrapInvalidationEvents = [
  "server:updated",
  "server:removed",
  "membership:updated",
  "channel:updated",
  "channel:removed",
  "category:updated",
  "category:removed",
  "server-role:updated",
  "server-role:removed",
  "friend:updated",
  "friend:removed",
  "user:deleted",
] as const;

export type BootstrapInvalidationEvent = typeof bootstrapInvalidationEvents[number];

interface EventRegistrar {
  on(event: string, listener: (...args: unknown[]) => void): unknown;
}

/** Installs the complete authoritative-resource invalidation surface. */
export function bindBootstrapInvalidations(registrar: EventRegistrar, refresh: () => void): void {
  for (const event of bootstrapInvalidationEvents) registrar.on(event, refresh);
}
