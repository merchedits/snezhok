import * as Notifications from "expo-notifications";
import * as TaskManager from "expo-task-manager";
import { BACKGROUND_NOTIFICATION_TASK, dismissCallNotification, handleMessageNotificationAction } from "./androidNotifications";
import { api } from "../infrastructure/http/apiClient";
import { extractNotificationTaskData } from "./notificationRouting";

if (!TaskManager.isTaskDefined(BACKGROUND_NOTIFICATION_TASK)) {
  TaskManager.defineTask<Notifications.NotificationTaskPayload>(BACKGROUND_NOTIFICATION_TASK, async ({ data, error }) => {
    if (error) return Notifications.BackgroundNotificationTaskResult.Failed;
    if (data && typeof data === "object" && "actionIdentifier" in data) {
      const response = data as Notifications.NotificationResponse;
      const callData = response.notification.request.content.data;
      if (response.actionIdentifier === "decline" && typeof callData?.roomId === "string") {
        await Promise.all([api.declineCall(callData.roomId).catch(() => undefined), dismissCallNotification(callData.roomId)]);
        return Notifications.BackgroundNotificationTaskResult.NewData;
      }
      if (["reply", "mark-read", "mute"].includes(response.actionIdentifier)) {
        const handled = await handleMessageNotificationAction(response.actionIdentifier, callData, response.userText).catch(() => false);
        return handled ? Notifications.BackgroundNotificationTaskResult.NewData : Notifications.BackgroundNotificationTaskResult.NoData;
      }
    }
    const payload = extractNotificationTaskData(data);
    if (payload?.notificationType === "call-ended" && typeof payload.roomId === "string") {
      await dismissCallNotification(payload.roomId, payload.answered !== true);
      return Notifications.BackgroundNotificationTaskResult.NewData;
    }
    return Notifications.BackgroundNotificationTaskResult.NoData;
  });
}
