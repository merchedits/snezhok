export type ActivityParticipantStatus = "invited" | "active" | "submitted" | "completed" | "declined";

export function participantMaySubmit(status: ActivityParticipantStatus | undefined) {
  return status === "invited" || status === "active";
}

export function participantMayEditEntry(entryOwnerId: string, actorId: string, action: string) {
  return (action !== "update-item" && action !== "remove-item") || entryOwnerId === actorId;
}

export function selectionAfterEntryChange(
  result: Record<string, unknown> | null,
  entryId: string,
  unavailable: boolean,
) {
  if (!unavailable || result?.selectedEntryId !== entryId) return result ?? {};
  const { selectedEntryId: _selectedEntryId, pickedAt: _pickedAt, ...remaining } = result;
  return remaining;
}
