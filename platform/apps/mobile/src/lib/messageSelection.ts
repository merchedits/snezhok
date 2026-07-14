import type { Message } from "@snezhok/contracts";

/** Builds clipboard text in the same chronological order it appears in chat. */
export function selectedMessageText(messages: Message[]): string {
  return [...messages]
    .sort((left, right) => left.sequence - right.sequence)
    .map((message) => message.text.trim())
    .filter(Boolean)
    .join("\n");
}
