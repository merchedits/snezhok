import type { UserSummary } from "@snezhok/contracts";

export interface MentionQuery {
  start: number;
  end: number;
  query: string;
}

/**
 * Returns the @mention token immediately before the caret. Tokens inside an
 * email address are deliberately ignored, as are completed mentions followed
 * by whitespace.
 */
export function activeMentionQuery(text: string, caret = text.length): MentionQuery | null {
  const safeCaret = Math.max(0, Math.min(text.length, caret));
  const prefix = text.slice(0, safeCaret);
  const match = /(^|\s)@([\p{L}\p{N}._-]{0,32})$/u.exec(prefix);
  if (!match) return null;
  const query = match[2] ?? "";
  const start = safeCaret - query.length - 1;
  return { start, end: safeCaret, query };
}

export function mentionSuggestions(
  participants: readonly UserSummary[],
  query: string,
  currentUserId?: string,
  limit = 6,
): UserSummary[] {
  const normalized = query.trim().toLocaleLowerCase();
  const unique = new Map<string, UserSummary>();
  for (const participant of participants) {
    if (participant.id === currentUserId || unique.has(participant.id)) continue;
    const username = participant.username.toLocaleLowerCase();
    const displayName = participant.displayName.toLocaleLowerCase();
    if (normalized && !username.startsWith(normalized) && !displayName.startsWith(normalized)) continue;
    unique.set(participant.id, participant);
  }
  return [...unique.values()]
    .sort((left, right) => {
      const leftUsername = left.username.toLocaleLowerCase();
      const rightUsername = right.username.toLocaleLowerCase();
      const leftExact = leftUsername === normalized ? 0 : leftUsername.startsWith(normalized) ? 1 : 2;
      const rightExact = rightUsername === normalized ? 0 : rightUsername.startsWith(normalized) ? 1 : 2;
      return leftExact - rightExact || left.displayName.localeCompare(right.displayName);
    })
    .slice(0, Math.max(0, limit));
}

export function insertMention(text: string, mention: MentionQuery, username: string): { text: string; caret: number } {
  const safeUsername = username.replace(/[^\p{L}\p{N}._-]/gu, "");
  const nextCharacter = text[mention.end];
  const separator = nextCharacter === undefined || /\s/u.test(nextCharacter) ? " " : "";
  const inserted = `@${safeUsername}${separator}`;
  const next = `${text.slice(0, mention.start)}${inserted}${text.slice(mention.end)}`;
  return { text: next, caret: mention.start + inserted.length };
}
