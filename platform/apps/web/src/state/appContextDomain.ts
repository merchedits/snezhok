import type { BootstrapPayload, Id, Message, MessagePreview } from "@snezhok/contracts";

import { productCapabilities } from "../config/productCapabilities.js";
import { RequestError } from "../lib/api.js";

export interface StreamSelection { kind: "conversation" | "channel"; id: Id }

const BOOTSTRAP_CACHE = "snezhok.v3.bootstrap";
const SELECTION_CACHE = "snezhok.v3.selection";
const OWNER_CACHE = "snezhok.v3.owner";

export function selectionKey(selection: StreamSelection) { return `${selection.kind}:${selection.id}`; }

export function parseCache<T>(key: string): T | null {
  try { const value = localStorage.getItem(key); return value ? JSON.parse(value) as T : null; }
  catch { return null; }
}

export function writeCache(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); }
  catch { /* A full or disabled cache must not break messaging. */ }
}

export function cachedBootstrap(): BootstrapPayload | null {
  const payload = parseCache<BootstrapPayload>(BOOTSTRAP_CACHE);
  return payload && localStorage.getItem(OWNER_CACHE) === payload.me.id ? payload : null;
}

export function cacheBootstrap(payload: BootstrapPayload): void {
  writeCache(BOOTSTRAP_CACHE, payload);
  localStorage.setItem(OWNER_CACHE, payload.me.id);
}

export function cacheSelection(selection: StreamSelection): void { writeCache(SELECTION_CACHE, selection); }
export function cachedOwnerId(): string | null { return localStorage.getItem(OWNER_CACHE) ?? parseCache<BootstrapPayload>(BOOTSTRAP_CACHE)?.me.id ?? null; }
export function setCachedOwner(ownerId: string): void { localStorage.setItem(OWNER_CACHE, ownerId); }
export function clearCachedSession(options: { preserveOwner?: boolean } = {}): void {
  localStorage.removeItem(BOOTSTRAP_CACHE);
  localStorage.removeItem(SELECTION_CACHE);
  if (!options.preserveOwner) localStorage.removeItem(OWNER_CACHE);
}

export function initialSelection(payload: BootstrapPayload): StreamSelection | null {
  const cached = parseCache<StreamSelection>(SELECTION_CACHE);
  if (cached?.kind === "conversation" && payload.conversations.some((item) => item.id === cached.id)) return cached;
  if (productCapabilities.servers && cached?.kind === "channel" && payload.channels.some((item) => item.id === cached.id)) return cached;
  const conversation = payload.conversations.find((item) => !item.archived) || payload.conversations[0];
  if (conversation) return { kind: "conversation", id: conversation.id };
  const channel = productCapabilities.servers ? payload.channels.find((item) => item.kind === "text") : undefined;
  return channel ? { kind: "channel", id: channel.id } : null;
}

export function mergeMessage(list: Message[], incoming: Message): Message[] {
  const optimisticIndex = list.findIndex((message) => message.id === incoming.id || Boolean(incoming.clientId && (message.clientId === incoming.clientId || ((message.pending || message.failed) && message.id === incoming.clientId))));
  if (optimisticIndex >= 0) { const next = [...list]; next[optimisticIndex] = incoming; return next.sort((a, b) => a.sequence - b.sequence); }
  if (list.some((message) => message.id === incoming.id)) return list;
  return [...list, incoming].sort((a, b) => a.sequence - b.sequence);
}

export function toPreview(message: Message): MessagePreview {
  return { id: message.id, senderId: message.sender.id, senderName: message.sender.displayName, text: message.text, kind: message.kind, createdAt: message.createdAt };
}

export function userMessage(error: unknown): string {
  if (error instanceof RequestError) return error.message;
  if (error instanceof Error) return error.message;
  return "Request failed. Retry.";
}

export function isPermanentOutboxFailure(error: unknown): boolean {
  return error instanceof RequestError && error.status >= 400 && error.status < 500 && ![408, 409, 425, 429].includes(error.status);
}

export function outboxDelay(attempts: number): number { return Math.min(60_000, 1_000 * (2 ** Math.min(6, Math.max(0, attempts - 1)))); }
