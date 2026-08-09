import type { AppSettings } from "@snezhok/contracts";

export const defaultSettings: AppSettings = {
  theme: "system",
  accent: "blue",
  fontScale: 1,
  density: "comfortable",
  bubbleRadius: 16,
  reducedMotion: false,
  highContrast: false,
  language: "ru",
  readReceipts: true,
  showLastSeen: true,
  stripMediaLocation: true,
  defaultUploadQuality: "auto",
  autoDownloadWifi: true,
  autoDownloadMobile: false,
  noiseSuppression: "standard",
  echoCancellation: true,
  autoGainControl: true,
  microphoneMode: "phone",
  callAudioRoute: "auto",
  callQuality: "auto",
  screenShareQuality: "auto",
  pushToTalk: false,
  cooperativeMatureContent: false,
  messageNotifications: true,
  callNotifications: true,
  notificationPreviews: true,
  notificationSound: true,
  notificationMobile: true,
  notificationMentionsOnly: false,
  quietHoursStart: null,
  quietHoursEnd: null,
  quietHoursTimezoneOffsetMinutes: 0,
  quietHoursDays: [0, 1, 2, 3, 4, 5, 6],
};

/**
 * `accent` remains in the wire shape so installed 3.x clients can update
 * without a breaking settings migration. The 4.x product palette is fixed,
 * so legacy stored or submitted accent choices are always normalized away.
 */
export function normalizeSettings(settings: Partial<AppSettings> | null | undefined): AppSettings {
  return { ...defaultSettings, ...(settings ?? {}), accent: "blue" };
}
