export type CallLanguage = "ru" | "en";

const copy = {
  ru: {
    incoming: "Входящий звонок",
    incomingFrom: "Звонит {name}",
    acceptAudio: "Ответить",
    acceptVideo: "С видео",
    decline: "Отклонить",
    active: "Идёт звонок",
    returnToCall: "Вернуться к звонку",
    alreadyActive: "Сначала завершите текущий звонок.",
    shareTitle: "Показать экран?",
    shareBody: "Android покажет системное подтверждение. Уведомления и личные данные на экране могут быть видны участникам.",
    startShare: "Начать",
    outputTest: "Проверить динамик",
    outputTestBody: "Короткий сигнал будет воспроизведён через выбранное устройство.",
    endForEveryone: "Завершить для всех",
    endForEveryoneBody: "Все участники будут отключены от этого звонка.",
    participantVolume: "Громкость участника",
    muteParticipant: "Без звука",
    callDetails: "Сведения о звонке",
    ping: "Задержка",
    jitter: "Джиттер",
    loss: "Потери",
    bitrate: "Битрейт",
    codec: "Кодек",
    transport: "ICE-транспорт",
    reconnects: "Переподключения",
    microphoneLevel: "Уровень микрофона",
    minimize: "Свернуть",
    permissionRestricted: "Для этого действия недостаточно прав в голосовом канале.",
  },
  en: {
    incoming: "Incoming call",
    incomingFrom: "{name} is calling",
    acceptAudio: "Answer",
    acceptVideo: "Video",
    decline: "Decline",
    active: "Call in progress",
    returnToCall: "Return to call",
    alreadyActive: "End the current call first.",
    shareTitle: "Share your screen?",
    shareBody: "Android will show a system confirmation. Notifications and private information on screen may be visible to participants.",
    startShare: "Start",
    outputTest: "Test speaker",
    outputTestBody: "A short tone will play through the selected audio device.",
    endForEveryone: "End for everyone",
    endForEveryoneBody: "Every participant will be disconnected from this call.",
    participantVolume: "Participant volume",
    muteParticipant: "Mute",
    callDetails: "Call details",
    ping: "Latency",
    jitter: "Jitter",
    loss: "Packet loss",
    bitrate: "Bitrate",
    codec: "Codec",
    transport: "ICE transport",
    reconnects: "Reconnects",
    microphoneLevel: "Microphone level",
    minimize: "Minimize",
    permissionRestricted: "Your voice-channel role does not allow this action.",
  },
} as const;

export function callCopy(language: CallLanguage) {
  return copy[language];
}

export function interpolateCallCopy(value: string, variables: Record<string, string | number>): string {
  return value.replace(/\{(\w+)\}/g, (_, key: string) => String(variables[key] ?? `{${key}}`));
}
