import * as Notifications from "expo-notifications";
import { AppState, Platform } from "react-native";

import type { CallUpdatePayload, Message } from "@snezhok/contracts";

import { navigationRef } from "../navigation/navigationRef";
import { useAppStore } from "../store/useAppStore";
import { shouldNotifyCall, shouldNotifyMessage } from "./notificationPolicy";

const MESSAGE_CHANNEL = "messages-v1";
const CALL_CHANNEL = "calls-v1";
const callNotifications = new Map<string, string>();
let configured: Promise<boolean> | null = null;
let pendingNavigation: NotificationTarget | null = null;
let lastHandledNotificationId: string | null = null;

type NotificationTarget =
  | { type: "message"; streamId: string; streamKind: "conversation" | "channel"; title: string }
  | { type: "call"; streamId: string; title: string };

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export async function initializeAndroidNotifications(): Promise<boolean> {
  if (Platform.OS !== "android") return false;
  if (configured) return configured;
  configured = (async () => {
    await Notifications.setNotificationChannelAsync(MESSAGE_CHANNEL, {
      name: "Сообщения",
      description: "Новые сообщения Snezhok",
      importance: Notifications.AndroidImportance.HIGH,
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
      sound: "default",
      vibrationPattern: [0, 180],
      enableVibrate: true,
      showBadge: true,
      audioAttributes: {
        usage: Notifications.AndroidAudioUsage.NOTIFICATION_COMMUNICATION_INSTANT,
        contentType: Notifications.AndroidAudioContentType.SONIFICATION,
      },
    });
    await Notifications.setNotificationChannelAsync(CALL_CHANNEL, {
      name: "Звонки",
      description: "Входящие звонки Snezhok",
      importance: Notifications.AndroidImportance.MAX,
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      sound: "default",
      vibrationPattern: [0, 400, 180, 400, 180, 700],
      enableVibrate: true,
      showBadge: true,
      audioAttributes: {
        usage: Notifications.AndroidAudioUsage.NOTIFICATION_COMMUNICATION_REQUEST,
        contentType: Notifications.AndroidAudioContentType.SONIFICATION,
      },
    });
    let permission = await Notifications.getPermissionsAsync();
    if (!permission.granted && permission.canAskAgain) permission = await Notifications.requestPermissionsAsync();
    return permission.granted;
  })().catch((error) => {
    console.warn("Android notifications could not be initialized", error);
    configured = null;
    return false;
  });
  return configured;
}

export async function notifyIncomingMessage(message: Message): Promise<void> {
  const state = useAppStore.getState();
  if (!shouldNotifyMessage(message, state.me?.id) || !(await initializeAndroidNotifications())) return;
  const route = navigationRef.isReady() ? navigationRef.getCurrentRoute() : undefined;
  if (AppState.currentState === "active" && route?.name === "Chat" && route.params.streamId === message.streamId) return;
  const conversation = state.conversations.find((item) => item.id === message.streamId);
  const channel = state.channels.find((item) => item.id === message.streamId);
  const title = conversation?.title ?? channel?.name ?? message.sender.displayName;
  const language = state.settings.language;
  await Notifications.scheduleNotificationAsync({
    content: {
      title: message.sender.displayName,
      body: notificationMessageBody(message, language),
      sound: "default",
      priority: Notifications.AndroidNotificationPriority.HIGH,
      color: "#35b9ef",
      data: {
        notificationType: "message",
        streamId: message.streamId,
        streamKind: message.streamKind,
        title,
      },
    },
    trigger: { channelId: MESSAGE_CHANNEL },
  });
}

/** Remove every presented notification for a stream once its chat is opened. */
export async function dismissMessageNotifications(streamId: string): Promise<void> {
  if (Platform.OS !== "android") return;
  const presented = await Notifications.getPresentedNotificationsAsync();
  const matching = presented.filter((notification) => {
    const data = notification.request.content.data;
    return data?.notificationType === "message" && data.streamId === streamId;
  });
  await Promise.all(matching.map((notification) =>
    Notifications.dismissNotificationAsync(notification.request.identifier).catch(() => undefined),
  ));
}

export async function handleCallUpdate(payload: CallUpdatePayload): Promise<void> {
  if (payload.state === "ended") {
    const notificationId = callNotifications.get(payload.roomId);
    if (notificationId) await Notifications.dismissNotificationAsync(notificationId).catch(() => undefined);
    callNotifications.delete(payload.roomId);
    return;
  }
  const state = useAppStore.getState();
  if (!shouldNotifyCall(payload, state.me?.id) || !(await initializeAndroidNotifications())) return;
  const route = navigationRef.isReady() ? navigationRef.getCurrentRoute() : undefined;
  if (AppState.currentState === "active" && route?.name === "Call" && route.params.streamId === payload.streamId) return;
  const language = state.settings.language;
  const caller = payload.callerName ?? (language === "ru" ? "Snezhok" : "Snezhok");
  const title = payload.title ?? caller;
  const notificationId = await Notifications.scheduleNotificationAsync({
    content: {
      title: language === "ru" ? `Входящий звонок · ${caller}` : `Incoming call · ${caller}`,
      body: language === "ru" ? "Нажмите, чтобы ответить" : "Tap to answer",
      sound: "default",
      priority: Notifications.AndroidNotificationPriority.MAX,
      color: "#35b9ef",
      autoDismiss: true,
      data: { notificationType: "call", streamId: payload.streamId, title },
    },
    trigger: { channelId: CALL_CHANNEL },
  });
  callNotifications.set(payload.roomId, notificationId);
}

export function handleNotificationResponse(response: Notifications.NotificationResponse): void {
  const identifier = response.notification.request.identifier;
  if (identifier === lastHandledNotificationId) return;
  lastHandledNotificationId = identifier;
  const target = notificationTarget(response.notification.request.content.data);
  if (target) navigateToNotificationTarget(target);
}

export function flushPendingNotificationNavigation(): void {
  if (!pendingNavigation || !navigationRef.isReady()) return;
  const target = pendingNavigation;
  pendingNavigation = null;
  navigateToNotificationTarget(target);
}

function navigateToNotificationTarget(target: NotificationTarget) {
  if (!navigationRef.isReady()) {
    pendingNavigation = target;
    return;
  }
  if (target.type === "call") navigationRef.navigate("Call", { streamId: target.streamId, title: target.title });
  else navigationRef.navigate("Chat", { streamId: target.streamId, streamKind: target.streamKind, title: target.title });
}

function notificationTarget(data: Record<string, unknown> | undefined): NotificationTarget | null {
  if (!data) return null;
  if (data.notificationType === "call" && typeof data.streamId === "string" && typeof data.title === "string") {
    return { type: "call", streamId: data.streamId, title: data.title };
  }
  if (
    data.notificationType === "message"
    && typeof data.streamId === "string"
    && (data.streamKind === "conversation" || data.streamKind === "channel")
    && typeof data.title === "string"
  ) {
    return { type: "message", streamId: data.streamId, streamKind: data.streamKind, title: data.title };
  }
  return null;
}

function notificationMessageBody(message: Message, language: "ru" | "en") {
  if (message.text.trim()) return message.text.trim();
  const labels: Record<Message["kind"], [string, string]> = {
    text: ["Новое сообщение", "New message"],
    system: ["Системное сообщение", "System message"],
    voice: ["Голосовое сообщение", "Voice message"],
    "video-note": ["Видеосообщение", "Video message"],
    media: ["Фото или видео", "Photo or video"],
    file: ["Файл", "File"],
  };
  return labels[message.kind][language === "ru" ? 0 : 1];
}
