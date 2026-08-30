import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import * as Application from "expo-application";
import * as Crypto from "expo-crypto";
import * as Notifications from "expo-notifications";
import { AppState, Platform } from "react-native";

import type { CallUpdatePayload, Message } from "@snezhok/contracts";

import { receiveCallEnded, receiveCallUpdate } from "../calls/callSessionBridge";
import { isUserVisibleStreamKind, productCapabilities } from "../config/productCapabilities";
import { recordDiagnostic } from "../diagnostics/diagnostics";
import { api } from "../infrastructure/http/apiClient";
import { navigationRef } from "../navigation/navigationRef";
import { useAppStore } from "../store/useAppStore";
import { shouldNotifyCall, shouldNotifyMessage } from "./notificationPolicy";
import { notificationTargetFromData, type NotificationTarget } from "./notificationRouting";

export const MESSAGE_CHANNEL = "messages-v1";
export const CALL_CHANNEL = "calls-v1";
export const CALL_CATEGORY = "incoming-call-v1";
export const MESSAGE_CATEGORY = "message-actions-v1";
export const BACKGROUND_NOTIFICATION_TASK = "snezhok-background-notifications-v1";
const INSTALLATION_KEY = "@snezhok/push-installation/v1";
let configured: Promise<boolean> | null = null;
let remotePushRegistered = false;
let remotePushRegistration: Promise<boolean> | null = null;
let pendingNavigation: NotificationTarget | null = null;
const handledNotificationActions = new Set<string>();

Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const data = notification.request.content.data;
    const route = navigationRef.isReady() ? navigationRef.getCurrentRoute() : undefined;
    const hiddenServerNotification = data?.streamKind === "channel" && !productCapabilities.servers;
    const focusedMessage = AppState.currentState === "active"
      && data?.notificationType === "message"
      && typeof data.streamId === "string"
      && route?.name === "Chat"
      && route.params.streamId === data.streamId;
    const focusedCall = AppState.currentState === "active"
      && data?.notificationType === "call"
      && typeof data.streamId === "string"
      && route?.name === "Call"
      && route.params.streamId === data.streamId;
    const incomingCallSurface = AppState.currentState === "active" && data?.notificationType === "call";
    const visible = !hiddenServerNotification && !focusedMessage && !focusedCall && !incomingCallSurface;
    return { shouldPlaySound: visible, shouldSetBadge: false, shouldShowBanner: visible, shouldShowList: visible };
  },
});

export async function initializeAndroidNotifications(): Promise<boolean> {
  if (Platform.OS !== "android") return false;
  if (configured) return configured;
  configured = (async () => {
    const english = useAppStore.getState().settings.language === "en";
    await Notifications.setNotificationChannelAsync(MESSAGE_CHANNEL, {
      name: english ? "Messages" : "Сообщения", description: english ? "New Snezhok messages" : "Новые сообщения Snezhok", importance: Notifications.AndroidImportance.HIGH,
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE, sound: "default", vibrationPattern: [0, 180], enableVibrate: true, showBadge: true,
      audioAttributes: { usage: Notifications.AndroidAudioUsage.NOTIFICATION_COMMUNICATION_INSTANT, contentType: Notifications.AndroidAudioContentType.SONIFICATION },
    });
    await Notifications.setNotificationChannelAsync(CALL_CHANNEL, {
      name: english ? "Calls" : "Звонки", description: english ? "Incoming and missed Snezhok calls" : "Входящие и пропущенные звонки Snezhok", importance: Notifications.AndroidImportance.MAX,
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE, sound: "default", vibrationPattern: [0, 400, 180, 400, 180, 700], enableVibrate: true, showBadge: true,
      audioAttributes: { usage: Notifications.AndroidAudioUsage.NOTIFICATION_COMMUNICATION_REQUEST, contentType: Notifications.AndroidAudioContentType.SONIFICATION },
    });
    await Notifications.setNotificationCategoryAsync(CALL_CATEGORY, [
      { identifier: "answer", buttonTitle: english ? "Answer" : "Ответить", options: { opensAppToForeground: true } },
      { identifier: "answer-video", buttonTitle: english ? "Video" : "С видео", options: { opensAppToForeground: true } },
      { identifier: "decline", buttonTitle: english ? "Decline" : "Отклонить", options: { opensAppToForeground: false, isDestructive: true } },
    ]);
    await Notifications.setNotificationCategoryAsync(MESSAGE_CATEGORY, [
      { identifier: "reply", buttonTitle: english ? "Reply" : "Ответить", textInput: { submitButtonTitle: english ? "Send" : "Отправить", placeholder: english ? "Message" : "Сообщение" }, options: { opensAppToForeground: false } },
      { identifier: "mark-read", buttonTitle: english ? "Mark read" : "Прочитано", options: { opensAppToForeground: false } },
      { identifier: "mute", buttonTitle: english ? "Mute" : "Без звука", options: { opensAppToForeground: false } },
    ]);
    let permission = await Notifications.getPermissionsAsync();
    if (!permission.granted && permission.canAskAgain) permission = await Notifications.requestPermissionsAsync();
    if (permission.granted) await Notifications.registerTaskAsync(BACKGROUND_NOTIFICATION_TASK).catch(() => undefined);
    if (!permission.granted) configured = null;
    return permission.granted;
  })().catch((error: unknown) => { recordDiagnostic("warn", "notifications", "Android notifications could not be initialized", { errorName: diagnosticErrorName(error) }); configured = null; return false; });
  return configured;
}

/** Registers this install with Expo Push. Returns false when the build has no EAS/FCM project configured. */
export async function registerRemotePushDevice(): Promise<boolean> {
  if (remotePushRegistration) return remotePushRegistration;
  remotePushRegistration = (async () => {
    if (!(await initializeAndroidNotifications())) return false;
    if (!(await Notifications.getPermissionsAsync()).granted) {
      remotePushRegistered = false;
      return false;
    }
    const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    if (typeof projectId !== "string" || !projectId) {
      remotePushRegistered = false;
      return false;
    }
    try {
      const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
      let installationId = await AsyncStorage.getItem(INSTALLATION_KEY);
      if (!installationId) {
        installationId = `${Application.getAndroidId()}-${Crypto.randomUUID()}`;
        await AsyncStorage.setItem(INSTALLATION_KEY, installationId);
      }
      await api.registerPushDevice(token, installationId, Application.nativeApplicationVersion ?? "unknown");
      remotePushRegistered = true;
      return true;
    } catch (error: unknown) {
      remotePushRegistered = false;
      recordDiagnostic("warn", "notifications", "Remote push registration failed", { errorName: diagnosticErrorName(error) });
      return false;
    }
  })().finally(() => { remotePushRegistration = null; });
  return remotePushRegistration;
}

export async function notifyIncomingMessage(message: Message): Promise<void> {
  const state = useAppStore.getState();
  if (!isUserVisibleStreamKind(message.streamKind) || remotePushRegistered || !shouldNotifyMessage(message, state.me?.id) || !(await initializeAndroidNotifications())) return;
  const route = navigationRef.isReady() ? navigationRef.getCurrentRoute() : undefined;
  if (AppState.currentState === "active" && route?.name === "Chat" && route.params.streamId === message.streamId) return;
  const conversation = state.conversations.find((item) => item.id === message.streamId);
  if (conversation?.muted) return;
  const channel = state.channels.find((item) => item.id === message.streamId);
  const title = conversation?.title ?? channel?.name ?? message.sender.displayName;
  await Notifications.scheduleNotificationAsync({
    content: { title: message.sender.displayName, body: notificationMessageBody(message, state.settings.language), sound: "default", priority: Notifications.AndroidNotificationPriority.HIGH, color: "#35b9ef", categoryIdentifier: MESSAGE_CATEGORY, data: { notificationType: "message", streamId: message.streamId, streamKind: message.streamKind, title, sequence: message.sequence } },
    trigger: { channelId: MESSAGE_CHANNEL },
  });
}

export async function dismissMessageNotifications(streamId: string): Promise<void> {
  if (Platform.OS !== "android") return;
  const presented = await Notifications.getPresentedNotificationsAsync();
  await Promise.all(presented.filter(({ request }) => request.content.data?.notificationType === "message" && request.content.data.streamId === streamId).map(({ request }) => Notifications.dismissNotificationAsync(request.identifier).catch(() => undefined)));
}

export async function dismissCallNotification(roomId: string, showMissed = false): Promise<void> {
  const presented = await Notifications.getPresentedNotificationsAsync();
  const matching = presented.filter(({ request }) => request.content.data?.notificationType === "call" && request.content.data.roomId === roomId);
  await Promise.all(matching.map(({ request }) => Notifications.dismissNotificationAsync(request.identifier).catch(() => undefined)));
  if (showMissed && matching[0]) {
    const content = matching[0].request.content;
    const english = useAppStore.getState().settings.language === "en";
    await Notifications.scheduleNotificationAsync({
      content: { title: english ? "Missed call" : "Пропущенный звонок", body: content.title ?? "Snezhok", sound: "default", priority: Notifications.AndroidNotificationPriority.HIGH, color: "#35b9ef", ...(content.data ? { data: content.data } : {}) },
      trigger: { channelId: CALL_CHANNEL },
    });
  }
}

export async function handleRemoteNotification(notification: Notifications.Notification): Promise<void> {
  const data = notification.request.content.data;
  const target = notificationTargetFromData(data, Notifications.DEFAULT_ACTION_IDENTIFIER, Notifications.DEFAULT_ACTION_IDENTIFIER, productCapabilities.servers);
  if (target?.type === "call" && typeof data?.roomId === "string") {
    receiveCallUpdate({
      roomId: data.roomId,
      state: "started",
      participantIds: [],
      streamId: target.streamId,
      streamKind: data.streamKind === "channel" ? "channel" : "conversation",
      callerId: typeof data.callerId === "string" ? data.callerId : "remote-push",
      callerName: typeof data.callerName === "string" ? data.callerName : "Snezhok",
      title: target.title,
      startedAt: data.startedAt as number,
    });
  }
  if (data?.notificationType === "call-ended" && typeof data.roomId === "string") {
    receiveCallEnded(data.roomId);
    await dismissCallNotification(data.roomId, data.answered !== true);
  }
}

export async function handleCallUpdate(payload: CallUpdatePayload): Promise<void> {
  if (payload.state === "ended") {
    receiveCallUpdate(payload);
    const me = useAppStore.getState().me?.id;
    await dismissCallNotification(payload.roomId, Boolean(me && !payload.answeredByIds?.includes(me)));
    return;
  }
  const state = useAppStore.getState();
  if (payload.streamKind === "channel") return;
  if (state.settings.callNotifications === false || state.conversations.find((item) => item.id === payload.streamId)?.muted) return;
  if (remotePushRegistered || !shouldNotifyCall(payload, state.me?.id) || !(await initializeAndroidNotifications())) return;
  const route = navigationRef.isReady() ? navigationRef.getCurrentRoute() : undefined;
  if (AppState.currentState === "active" && route?.name === "Call" && route.params.streamId === payload.streamId) return;
  const caller = payload.callerName ?? "Snezhok";
  const title = payload.title ?? caller;
  const english = state.settings.language === "en";
  const notificationTitle = state.settings.notificationPreviews === false
    ? (english ? "Incoming call" : "Входящий звонок")
    : `${english ? "Incoming call" : "Входящий звонок"} · ${caller}`;
  await Notifications.scheduleNotificationAsync({
    content: { title: notificationTitle, body: english ? "Tap to answer" : "Нажмите, чтобы ответить", sound: "default", priority: Notifications.AndroidNotificationPriority.MAX, color: "#35b9ef", categoryIdentifier: CALL_CATEGORY, autoDismiss: true, data: { notificationType: "call", roomId: payload.roomId, streamId: payload.streamId, title, startedAt: payload.startedAt ?? Date.now() } },
    trigger: { channelId: CALL_CHANNEL },
  });
}

export function handleNotificationResponse(response: Notifications.NotificationResponse): void {
  const identifier = response.notification.request.identifier;
  const actionKey = `${identifier}:${response.actionIdentifier}`;
  if (handledNotificationActions.has(actionKey)) return;
  handledNotificationActions.add(actionKey);
  if (handledNotificationActions.size > 32) handledNotificationActions.delete(handledNotificationActions.values().next().value!);
  const data = response.notification.request.content.data;
  if (["reply", "mark-read", "mute"].includes(response.actionIdentifier)) {
    void handleMessageNotificationAction(response.actionIdentifier, data, response.userText).catch(() => undefined);
    return;
  }
  if (response.actionIdentifier === "decline") {
    if (typeof data?.roomId === "string") { void api.declineCall(data.roomId).catch(() => undefined); void dismissCallNotification(data.roomId); }
    return;
  }
  const target = notificationTargetFromData(data, response.actionIdentifier, Notifications.DEFAULT_ACTION_IDENTIFIER, productCapabilities.servers);
  if (target) navigateToNotificationTarget(target);
  else if (data?.notificationType === "call" && typeof data.roomId === "string") void dismissCallNotification(data.roomId);
}

export async function handleMessageNotificationAction(action: string, data: Record<string, unknown> | undefined, userText?: string): Promise<boolean> {
  if (!data || data.notificationType !== "message" || typeof data.streamId !== "string") return false;
  if (action === "reply") {
    const text = userText?.trim().slice(0, 16_000) ?? "";
    if (!text) return false;
    await api.createMessage(data.streamId, { clientId: Crypto.randomUUID(), text, kind: "text", replyToId: null, attachmentIds: [], silent: false });
  } else if (action === "mark-read") {
    if (typeof data.sequence !== "number" || !Number.isSafeInteger(data.sequence) || data.sequence < 1) return false;
    await api.markRead(data.streamId, data.sequence);
  } else if (action === "mute") {
    if (data.streamKind !== "conversation") return false;
    const updated = await api.updateConversationPreferences(data.streamId, { muted: true });
    useAppStore.getState().applyConversation(updated);
  } else return false;
  await dismissMessageNotifications(data.streamId);
  return true;
}

export function flushPendingNotificationNavigation(): void {
  if (!pendingNavigation || !navigationRef.isReady()) return;
  const target = pendingNavigation; pendingNavigation = null; navigateToNotificationTarget(target);
}

function navigateToNotificationTarget(target: NotificationTarget) {
  if (!navigationRef.isReady()) { pendingNavigation = target; return; }
  if (target.type === "call") navigationRef.navigate("Call", { streamId: target.streamId, title: target.title, startWithVideo: target.startWithVideo, expectedCallId: target.expectedCallId });
  else navigationRef.navigate("Chat", { streamId: target.streamId, streamKind: target.streamKind, title: target.title });
}

function notificationMessageBody(message: Message, language: "ru" | "en") {
  if (message.text.trim()) return message.text.trim();
  const labels: Record<Message["kind"], [string, string]> = { text: ["Новое сообщение", "New message"], system: ["Системное сообщение", "System message"], voice: ["Голосовое сообщение", "Voice message"], "video-note": ["Видеосообщение", "Video message"], media: ["Фото или видео", "Photo or video"], file: ["Файл", "File"] };
  return labels[message.kind][language === "ru" ? 0 : 1];
}

function diagnosticErrorName(error: unknown): string {
  return error instanceof Error && error.name ? error.name.slice(0, 80) : "UnknownError";
}
