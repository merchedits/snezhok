import type { Message } from "@snezhok/contracts";

export function normalizeCachedMessages(value: unknown): Record<string, Message[]> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).map(([streamId, items]) => [streamId, Array.isArray(items) ? items.filter(isSafeCachedMessage).map((message) => ({ ...message, attachments: Array.isArray(message.attachments) ? message.attachments : [], reactions: Array.isArray(message.reactions) ? message.reactions : [] })) : []]));
}

function isSafeCachedMessage(value: unknown): value is Message {
  if (!value || typeof value !== "object") return false;
  const message = value as { id?: unknown; streamId?: unknown; sequence?: unknown; createdAt?: unknown; sender?: { id?: unknown } };
  return typeof message.id === "string" && typeof message.streamId === "string" && typeof message.sequence === "number" && typeof message.createdAt === "number" && typeof message.sender?.id === "string";
}
