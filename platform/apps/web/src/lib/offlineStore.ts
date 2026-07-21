import type { Id, Message, MessageKind } from "@snezhok/contracts";

const DATABASE = "snezhok-web-v3";
const VERSION = 2;
const MESSAGES = "messages";
const DRAFTS = "drafts";
const OUTBOX = "outbox";
const META = "meta";
const OWNER_KEY = "owner";

export interface OutboxEntry {
  clientId: Id;
  streamId: Id;
  streamKind: "conversation" | "channel";
  text: string;
  kind: MessageKind;
  replyToId: Id | null;
  attachmentIds: Id[];
  optimistic: Message;
  createdAt: number;
  attempts?: number;
  nextAttemptAt?: number;
}

interface MessageRecord { key: string; messages: Message[] }
interface DraftRecord { key: string; text: string }

let databasePromise: Promise<IDBDatabase> | null = null;
const pendingMessageWrites = new Map<string, { record: MessageRecord; resolve: Array<() => void> }>();
let messageFlushScheduled = false;

function database(): Promise<IDBDatabase> {
  if (!databasePromise) databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(MESSAGES)) db.createObjectStore(MESSAGES, { keyPath: "key" });
      if (!db.objectStoreNames.contains(DRAFTS)) db.createObjectStore(DRAFTS, { keyPath: "key" });
      if (!db.objectStoreNames.contains(OUTBOX)) db.createObjectStore(OUTBOX, { keyPath: "clientId" });
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: "key" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { databasePromise = null; reject(request.error); };
    request.onblocked = () => { databasePromise = null; reject(new Error("Offline database upgrade blocked")); };
  });
  return databasePromise;
}

async function read<T>(storeName: string, key: IDBValidKey): Promise<T | null> {
  try {
    const db = await database();
    return await new Promise((resolve, reject) => {
      const request = db.transaction(storeName, "readonly").objectStore(storeName).get(key);
      request.onsuccess = () => resolve((request.result as T | undefined) ?? null);
      request.onerror = () => reject(request.error);
    });
  } catch { return null; }
}

async function write(storeName: string, value: unknown): Promise<void> {
  const db = await database();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(storeName, "readwrite");
    transaction.objectStore(storeName).put(value);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error(`Could not write ${storeName}`));
    transaction.onabort = () => reject(transaction.error ?? new Error(`Writing ${storeName} was aborted`));
  });
}

async function remove(storeName: string, key: IDBValidKey): Promise<void> {
  const db = await database();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(storeName, "readwrite");
    transaction.objectStore(storeName).delete(key);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error(`Could not delete from ${storeName}`));
    transaction.onabort = () => reject(transaction.error ?? new Error(`Deleting from ${storeName} was aborted`));
  });
}

async function bestEffort(operation: Promise<void>): Promise<void> {
  try { await operation; } catch { /* Noncritical cache writes may fail in private browsing or at quota. */ }
}

export async function loadCachedMessages(key: string): Promise<Message[]> {
  return (await read<MessageRecord>(MESSAGES, key))?.messages ?? [];
}

export function cacheMessages(key: string, messages: Message[]): Promise<void> {
  const record = { key, messages: messages.slice(-150) } satisfies MessageRecord;
  return new Promise<void>((resolve) => {
    const pending = pendingMessageWrites.get(key);
    pendingMessageWrites.set(key, pending
      ? { record, resolve: [...pending.resolve, resolve] }
      : { record, resolve: [resolve] });
    if (messageFlushScheduled) return;
    messageFlushScheduled = true;
    queueMicrotask(() => {
      messageFlushScheduled = false;
      const batch = [...pendingMessageWrites.values()];
      pendingMessageWrites.clear();
      for (const entry of batch) {
        void bestEffort(write(MESSAGES, entry.record)).finally(() => entry.resolve.forEach((done) => done()));
      }
    });
  });
}

export async function loadDraft(key: string): Promise<string> {
  return (await read<DraftRecord>(DRAFTS, key))?.text ?? "";
}

export function saveDraft(key: string, text: string): Promise<void> {
  return bestEffort(text ? write(DRAFTS, { key, text } satisfies DraftRecord) : remove(DRAFTS, key));
}

export function enqueueOutbox(entry: OutboxEntry): Promise<void> { return write(OUTBOX, entry); }
export function removeOutbox(clientId: Id): Promise<void> { return remove(OUTBOX, clientId); }

export async function loadOutbox(): Promise<OutboxEntry[]> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const request = db.transaction(OUTBOX, "readonly").objectStore(OUTBOX).getAll();
    request.onsuccess = () => resolve((request.result as OutboxEntry[]).sort((a, b) => a.createdAt - b.createdAt));
    request.onerror = () => reject(request.error ?? new Error("Could not read the outbox"));
  });
}

export async function clearOfflineData(): Promise<void> {
  const db = await database();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction([MESSAGES, DRAFTS, OUTBOX], "readwrite");
    transaction.objectStore(MESSAGES).clear();
    transaction.objectStore(DRAFTS).clear();
    transaction.objectStore(OUTBOX).clear();
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Could not clear offline data"));
    transaction.onabort = () => reject(transaction.error ?? new Error("Clearing offline data was aborted"));
  });
}

/**
 * Claims the durable browser cache for one authenticated account. A user
 * switch is handled in one IndexedDB transaction so no message, draft, or
 * queued send can cross the account boundary.
 */
export async function claimOfflineOwner(ownerId: Id): Promise<boolean> {
  const db = await database();
  return new Promise<boolean>((resolve, reject) => {
    const transaction = db.transaction([MESSAGES, DRAFTS, OUTBOX, META], "readwrite");
    const metadata = transaction.objectStore(META);
    const ownerRequest = metadata.get(OWNER_KEY);
    let changed = false;
    ownerRequest.onsuccess = () => {
      const previous = (ownerRequest.result as { key: string; ownerId: Id } | undefined)?.ownerId;
      changed = Boolean(previous && previous !== ownerId);
      if (changed) {
        transaction.objectStore(MESSAGES).clear();
        transaction.objectStore(DRAFTS).clear();
        transaction.objectStore(OUTBOX).clear();
      }
      metadata.put({ key: OWNER_KEY, ownerId });
    };
    ownerRequest.onerror = () => reject(ownerRequest.error ?? new Error("Could not read offline owner"));
    transaction.oncomplete = () => resolve(changed);
    transaction.onerror = () => reject(transaction.error ?? new Error("Could not claim offline owner"));
    transaction.onabort = () => reject(transaction.error ?? new Error("Claiming offline owner was aborted"));
  });
}

export function updateOutbox(entry: OutboxEntry): Promise<void> {
  return write(OUTBOX, entry);
}
