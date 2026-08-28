import type { Message } from "@snezhok/contracts";

/** A receipt is evidence that remote content was actually presented. A route
 * remaining focused while Android backgrounds the process is insufficient. */
export function visibleReadSequence(
  messages: readonly Message[],
  meId: string | undefined,
  visible: { appActive: boolean; screenFocused: boolean; routeSettled: boolean },
): number | null {
  if (!meId || !visible.appActive || !visible.screenFocused || !visible.routeSettled) return null;
  let sequence: number | null = null;
  for (const message of messages) {
    if (message.deletedAt || message.sender.id === meId) continue;
    sequence = Math.max(sequence ?? 0, message.sequence);
  }
  return sequence;
}
