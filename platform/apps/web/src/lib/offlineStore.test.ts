import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Message } from "@snezhok/contracts";

class FakeRequest<T> {
  result!: T;
  error: DOMException | null = null;
  onsuccess: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onupgradeneeded: (() => void) | null = null;
  onblocked: (() => void) | null = null;
}

class FakeDatabase {
  stores = new Map<string, Map<IDBValidKey, unknown>>();
  objectStoreNames = { contains: (name: string) => this.stores.has(name) };
  createObjectStore(name: string) { this.stores.set(name, new Map()); }
  transaction(names: string | string[]) {
    const transaction = new FakeTransaction(this, Array.isArray(names) ? names : [names]);
    return transaction;
  }
}

class FakeTransaction {
  oncomplete: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  error: DOMException | null = null;
  constructor(private db: FakeDatabase, private names: string[]) {}
  objectStore(name: string) {
    if (!this.names.includes(name)) throw new Error("Store not in transaction");
    const values = this.db.stores.get(name)!;
    const complete = () => queueMicrotask(() => this.oncomplete?.());
    return {
      put: (value: Record<string, unknown>) => { values.set((value.key ?? value.clientId) as IDBValidKey, structuredClone(value)); complete(); },
      delete: (key: IDBValidKey) => { values.delete(key); complete(); },
      clear: () => { values.clear(); complete(); },
      get: (key: IDBValidKey) => resultRequest(values.get(key)),
      getAll: () => resultRequest([...values.values()]),
    };
  }
}

function resultRequest<T>(result: T) {
  const request = new FakeRequest<T>();
  request.result = structuredClone(result);
  queueMicrotask(() => request.onsuccess?.());
  return request;
}

function fakeIndexedDb() {
  const db = new FakeDatabase();
  return {
    open: () => {
      const request = new FakeRequest<FakeDatabase>();
      request.result = db;
      queueMicrotask(() => { request.onupgradeneeded?.(); request.onsuccess?.(); });
      return request;
    },
  } as unknown as IDBFactory;
}

function failingIndexedDb() {
  return {
    open: () => {
      const request = new FakeRequest<FakeDatabase>();
      request.error = new DOMException("storage unavailable", "UnknownError");
      queueMicrotask(() => request.onerror?.());
      return request;
    },
  } as unknown as IDBFactory;
}

describe("offline store", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal("indexedDB", fakeIndexedDb());
  });

  it("persists cached messages, drafts, and an idempotent outbox client id", async () => {
    const store = await import("./offlineStore.js");
    const message = {
      id: "client-1", clientId: "client-1", streamId: "stream-1", streamKind: "conversation", sequence: 1,
      sender: { id: "me", username: "me", displayName: "Me", avatarUrl: null, avatarColor: "#000", bio: "", statusText: "", presence: "offline", lastSeenAt: 0 }, kind: "text", text: "queued", replyTo: null,
      attachments: [], reactions: [], createdAt: 1, editedAt: null, deletedAt: null, pinnedAt: null, pending: true,
    } as Message;

    await store.cacheMessages("conversation:stream-1", [message]);
    await store.saveDraft("conversation:stream-1", "unfinished");
    await store.enqueueOutbox({
      clientId: "client-1", streamId: "stream-1", streamKind: "conversation", text: "queued", kind: "text",
      replyToId: null, attachmentIds: [], optimistic: message, createdAt: 1,
    });

    expect(await store.loadCachedMessages("conversation:stream-1")).toEqual([message]);
    expect(await store.loadDraft("conversation:stream-1")).toBe("unfinished");
    expect((await store.loadOutbox())[0]?.clientId).toBe("client-1");

    await store.removeOutbox("client-1");
    await store.saveDraft("conversation:stream-1", "");
    expect(await store.loadOutbox()).toEqual([]);
    expect(await store.loadDraft("conversation:stream-1")).toBe("");
  });

  it("atomically clears every durable store when the authenticated owner changes", async () => {
    const store = await import("./offlineStore.js");
    await store.claimOfflineOwner("user-a");
    await store.saveDraft("conversation:private", "secret draft");
    await store.cacheMessages("conversation:private", [{ id: "secret" } as Message]);
    await store.enqueueOutbox({
      clientId: "queued", streamId: "private", streamKind: "conversation", text: "secret", kind: "text",
      replyToId: null, attachmentIds: [], optimistic: { id: "queued" } as Message, createdAt: 1,
    });

    expect(await store.claimOfflineOwner("user-b")).toBe(true);
    expect(await store.loadDraft("conversation:private")).toBe("");
    expect(await store.loadCachedMessages("conversation:private")).toEqual([]);
    expect(await store.loadOutbox()).toEqual([]);
  });

  it("fails closed for owner and outbox durability while caches remain best effort", async () => {
    vi.resetModules();
    vi.stubGlobal("indexedDB", failingIndexedDb());
    const store = await import("./offlineStore.js");

    await expect(store.enqueueOutbox({ clientId: "queued" } as never)).rejects.toThrow("storage unavailable");
    await expect(store.loadOutbox()).rejects.toThrow("storage unavailable");
    await expect(store.claimOfflineOwner("user-a")).rejects.toThrow("storage unavailable");
    await expect(store.clearOfflineData()).rejects.toThrow("storage unavailable");
    await expect(store.cacheMessages("conversation:one", [])).resolves.toBeUndefined();
  });
});
