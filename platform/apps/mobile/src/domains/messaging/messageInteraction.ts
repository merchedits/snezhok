export type MessagePrimaryPressAction = "open-reactions" | "toggle-selection";

/**
 * Ordinary message taps are immediate. Selection mode is the only state that
 * changes the primary action; quick reactions remain explicit buttons so a
 * recycled row never needs a delayed double-tap timer.
 */
export function messagePrimaryPressAction(selectionMode: boolean): MessagePrimaryPressAction {
  return selectionMode ? "toggle-selection" : "open-reactions";
}
