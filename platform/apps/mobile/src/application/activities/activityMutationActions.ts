import { ApiError } from "../../lib/apiError";
import type { AppState, AppStoreGet } from "../../store/appState";

export interface ActivityMutationDependencies {
  get: AppStoreGet;
  createId: () => string;
  transport: Pick<typeof import("../../infrastructure/http/apiClient").api, "createActivity" | "commandActivity" | "activity">;
}

export type ActivityMutationActions = Pick<AppState, "createActivity" | "commandActivity">;

/** Idempotent cooperative-activity commands with bounded ambiguity recovery. */
export function createActivityMutationActions({ get, createId, transport }: ActivityMutationDependencies): ActivityMutationActions {
  return {
    createActivity: async (conversationId, type, options = {}) => {
      if (!get().capabilities.activities) throw new Error("ACTIVITIES_DISABLED");
      if (!get().online) throw new Error("Activities require a network connection");
      const clientId = createId();
      let saved;
      try {
        saved = await transport.createActivity(conversationId, type, options, clientId);
      } catch (error) {
        if (!transportMayHaveCommitted(error)) throw error;
        saved = await transport.createActivity(conversationId, type, options, clientId);
      }
      get().applyMessage(saved, "created");
      return saved;
    },

    commandActivity: async (message, action, payload = {}) => {
      if (!message.activity) throw new Error("Activity is no longer available");
      if (!get().online) throw new Error("Activities require a network connection");
      const clientId = createId();
      let expectedRevision = message.activity.revision;
      let retriedTransport = false;
      let retriedRevision = false;
      for (;;) {
        try {
          const saved = await transport.commandActivity(message.activity.id, expectedRevision, action, payload, clientId);
          get().applyMessage(saved, "updated");
          return saved;
        } catch (error) {
          if (!retriedRevision && error instanceof ApiError && error.status === 409 && /changed/i.test(error.message)) {
            retriedRevision = true;
            expectedRevision = (await transport.activity(message.activity.id)).revision;
            continue;
          }
          if (!retriedTransport && transportMayHaveCommitted(error)) {
            retriedTransport = true;
            continue;
          }
          throw error;
        }
      }
    },
  };
}

function transportMayHaveCommitted(error: unknown): boolean {
  return !(error instanceof ApiError) || error.status >= 500 || error.status === 408;
}
