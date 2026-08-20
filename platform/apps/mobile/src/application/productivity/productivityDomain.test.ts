import assert from "node:assert/strict";
import test from "node:test";

import { defaultRuntimeCapabilities, defaultSettings, type AppState, type AppStorePatch } from "../../store/appState";
import { emptyAttachmentRepository } from "../../repositories/attachments/attachmentRepository";
import { emptyMessageRepository } from "../../repositories/messages/messageRepository";
import { createProductivityDomain, type ProductivityStorage, type ProductivityTransport } from "./productivityDomain";

test("dirty local draft tombstones win over an older remote draft", async () => {
  const saved: Array<[string, string]> = [];
  const fixture = createFixture({
    productivity: async () => ({ drafts: [{ streamId: "chat", streamKind: "conversation", text: "remote", replyToId: null, updatedAt: 1 }], folders: [], scheduled: [] }),
    saveDraft: async (streamId, text) => { saved.push([streamId, text]); },
  });
  fixture.state.drafts = { chat: "" };
  fixture.domain.restore({ pendingSettings: {}, dirtyDraftIds: ["chat"] });

  await fixture.domain.actions.refreshProductivity();

  assert.equal(fixture.state.drafts.chat, "");
  assert.deepEqual(saved, [["chat", ""]]);
});

test("account reset cancels a pending remote draft timer", async () => {
  let saves = 0;
  const fixture = createFixture({ saveDraft: async () => { saves += 1; } });
  fixture.domain.actions.setDraft("chat", "hello");
  fixture.domain.reset();

  await delay(650);
  assert.equal(saves, 0);
});

test("offline settings patch is durable and remains pending", async () => {
  const settingsWrites: unknown[] = [];
  const fixture = createFixture({}, {
    writePendingSettingsPatch: async (patch) => { settingsWrites.push(patch); },
  });
  fixture.state.online = false;

  await fixture.domain.actions.updateSettings({ language: "en" });

  assert.equal(fixture.state.settings.language, "en");
  assert.deepEqual(fixture.domain.pendingSettings(), { language: "en" });
  assert.deepEqual(settingsWrites, [{ language: "en" }]);
});

function createFixture(transportOverrides: Partial<ProductivityTransport> = {}, storageOverrides: Partial<ProductivityStorage> = {}) {
  let state = baseState();
  const transport = {
    productivity: async () => ({ drafts: [], folders: [], scheduled: [] }),
    saveDraft: async () => undefined,
    scheduleMessage: async () => { throw new Error("unused"); },
    cancelScheduledMessage: async () => undefined,
    createFolder: async () => { throw new Error("unused"); },
    updateFolder: async () => { throw new Error("unused"); },
    deleteFolder: async () => undefined,
    updateConversationPreferences: async () => { throw new Error("unused"); },
    updateSettings: async () => state.settings,
    ...transportOverrides,
  } as ProductivityTransport;
  const storage: ProductivityStorage = {
    writeDrafts: async () => undefined,
    writeDirtyDraftIds: async () => undefined,
    writePendingSettingsPatch: async () => undefined,
    ...storageOverrides,
  };
  const set = (patch: AppStorePatch) => {
    const value = typeof patch === "function" ? patch(state) : patch;
    state = { ...state, ...value };
  };
  const domain = createProductivityDomain({
    set,
    get: () => state,
    persist: () => undefined,
    captureGuard: () => 1,
    guardIsCurrent: () => true,
    transport,
    storage,
    createId: () => "id",
  });
  return { domain, get state() { return state; } };
}

function baseState(): AppState {
  return {
    phase: "ready", error: null, online: true, syncing: false, eventCursor: 0, me: null,
    conversations: [], servers: [], categories: [], channels: [], friends: [],
    settings: defaultSettings, capabilities: defaultRuntimeCapabilities, messages: {},
    attachmentRepository: emptyAttachmentRepository, messageRepository: emptyMessageRepository,
    messagePagination: {}, drafts: {}, folders: [], scheduledMessages: [], outbox: [],
  } as unknown as AppState;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
