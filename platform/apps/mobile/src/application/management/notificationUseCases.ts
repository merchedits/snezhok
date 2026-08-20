import type { NotificationPolicy } from "@snezhok/contracts";

import { productApi } from "../../infrastructure/http/productApiClient";

export const notificationUseCases = {
  serverPolicies: () => productApi.serverNotificationPolicies(),
  streamPolicies: () => productApi.streamNotificationPolicies(),
  setServerPolicy: (id: string, policy: NotificationPolicy) => productApi.setServerNotificationPolicy(id, policy),
  setStreamPolicy: (id: string, streamKind: "conversation" | "channel", policy: NotificationPolicy) => productApi.setStreamNotificationPolicy(id, streamKind, policy),
  clearServerPolicy: (id: string) => productApi.clearServerNotificationPolicy(id),
  clearStreamPolicy: (id: string) => productApi.clearStreamNotificationPolicy(id),
};
