import type { Message } from "@snezhok/contracts";
import * as Haptics from "expo-haptics";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Animated, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import Svg, { Path } from "react-native-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { usePalette } from "../hooks/usePalette";
import { useTranslation } from "../i18n";
import { activityQueries } from "../application/activities/activityQueries";
import { clearRealtimeDrawing, emitRealtimeDrawing, subscribeRealtimeDrawing } from "../lib/realtimeBridge";
import { userFacingError } from "../lib/userFacingError";
import { useAppStore } from "../store/useAppStore";
import type { UploadInput } from "../types";
import { AppIcon } from "./AppIcon";
import { useAppDialog } from "./AppDialogProvider";
import { AuthenticatedImage } from "./AuthenticatedImage";
import { AttachmentSheet } from "./AttachmentSheet";
import { BlitzInput, DrawGuess, IdeasJar, MemoryInput, MovieList, PhotoInput, QuestionInput, SongInput } from "./activities/CooperativeActivityInputs";
import { localized, Primary, ResultView, TerminalActivity, Waiting } from "./activities/CooperativeActivityShared";
import { cooperativeActivityStyles as styles } from "./activities/cooperativeActivityStyles";
import { ImageViewer } from "./ImageViewer";
import { useAuthorizedMedia } from "../hooks/useAuthorizedMedia";
import { Avatar } from "./Avatar";

export function CooperativeActivityModal({ message, onClose }: { message: Message | null; onClose: () => void }) {
  const summaryActivity = message?.activity;
  const palette = usePalette();
  const { language, t } = useTranslation();
  const insets = useSafeAreaInsets();
  const meId = useAppStore((state) => state.me?.id);
  const command = useAppStore((state) => state.commandActivity);
  const upload = useAppStore((state) => state.uploadAttachment);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [picker, setPicker] = useState(false);
  const [text, setText] = useState("");
  const [secondary, setSecondary] = useState("");
  const [answers, setAnswers] = useState<Array<"left" | "right" | null>>([]);
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
  const [drawing, setDrawing] = useState<number[][][]>([]);
  const [liveDrawing, setLiveDrawing] = useState<number[][][]>([]);
  const [error, setError] = useState<string | null>(null);
  const [celebrating, setCelebrating] = useState(false);
  const [detailActivity, setDetailActivity] = useState(summaryActivity?.detail === "full" ? summaryActivity : null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailReload, setDetailReload] = useState(0);
  const activity = summaryActivity && detailActivity?.id === summaryActivity.id && detailActivity.revision >= summaryActivity.revision ? detailActivity : summaryActivity;
  const drawingActivityId = summaryActivity?.type === "draw-guess" ? summaryActivity.id : null;
  const expectedCollages = activity?.type === "color-hunt" ? activity.participants.filter((participant) => participant.contributionCount >= 9 || ["submitted", "completed"].includes(participant.status)).length : 0;
  const readyCollages = activity?.type === "color-hunt" ? activity.entries.filter((entry) => entry.kind === "collage" && entry.attachments.length > 0).length : 0;
  const handleDrawingChange = useCallback(
    (next: number[][][]) => {
      setDrawing(next);
      if (drawingActivityId && message?.streamId) emitRealtimeDrawing(message.streamId, drawingActivityId, next);
    },
    [drawingActivityId, message?.streamId],
  );

  useEffect(() => {
    setText("");
    setSecondary("");
    setSelectedEntryId(null);
    setDrawing([]);
    setLiveDrawing([]);
    setError(null);
    const count = Array.isArray(activity?.config.prompts) ? activity.config.prompts.length : 0;
    setAnswers(Array.from({ length: count }, () => null));
  }, [summaryActivity?.id]);

  useEffect(() => (drawingActivityId ? subscribeRealtimeDrawing(drawingActivityId, setLiveDrawing) : undefined), [drawingActivityId]);

  useEffect(() => {
    if (!activity || activity.type !== "color-hunt") return;
    if (!expectedCollages || readyCollages >= expectedCollages) return;
    let active = true;
    const timer = setInterval(() => {
      if (!active) {
        clearInterval(timer);
        return;
      }
      void activityQueries
        .detail(activity.id)
        .then((next) => {
          if (active) setDetailActivity(next);
        })
        .catch(() => undefined);
    }, 1_000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [activity?.id, activity?.revision, activity?.type, expectedCollages, readyCollages]);

  useEffect(() => {
    if (!summaryActivity || summaryActivity.detail !== "summary") {
      setDetailActivity(summaryActivity ?? null);
      setDetailLoading(false);
      return;
    }
    let current = true;
    setDetailActivity(null);
    setDetailLoading(true);
    void activityQueries
      .detail(summaryActivity.id)
      .then((detail) => {
        if (current && detail.revision === summaryActivity.revision) setDetailActivity(detail);
      })
      .catch((next) => {
        if (current) setError(userFacingError(next, t));
      })
      .finally(() => {
        if (current) setDetailLoading(false);
      });
    return () => {
      current = false;
    };
  }, [summaryActivity?.id, summaryActivity?.revision, summaryActivity?.detail, detailReload, t]);

  if (!message || !summaryActivity || !activity) return null;
  const ownEntry = activity.entries.find((entry) => entry.createdBy === meId);
  const ownParticipant = activity.participants.find((participant) => participant.user.id === meId);
  const ownSubmitted = Boolean(ownEntry) || Boolean(ownParticipant && ["submitted", "completed"].includes(ownParticipant.status));
  const needsDetail = summaryActivity.detail === "summary" && (!detailActivity || detailActivity.revision < summaryActivity.revision);
  const run = async (action: string, payload: Record<string, unknown> = {}) => {
    if (busy) return false;
    setBusy(true);
    setError(null);
    try {
      const saved = await command({ ...message, activity }, action, payload);
      if (action === "guess" && saved.activity?.state === "completed") {
        setCelebrating(true);
        setTimeout(() => setCelebrating(false), 1_450);
      }
      if (["movie-list", "ideas-jar", "color-hunt", "draw-guess"].includes(activity.type) && saved.activity) setDetailActivity(await activityQueries.detail(saved.activity.id));
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
      if (!["movie-list", "ideas-jar", "color-hunt", "draw-guess"].includes(activity.type)) onClose();
      return true;
    } catch (next) {
      setError(userFacingError(next, t));
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => undefined);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const uploadSelection = async (inputs: UploadInput[]) => {
    setPicker(false);
    setBusy(true);
    setError(null);
    try {
      const attachments = [];
      const ownPhotoCount = activity.type === "color-hunt" ? activity.entries.filter((entry) => entry.createdBy === meId && entry.kind === "photo").flatMap((entry) => entry.attachments).length : 0;
      const limit = activity.type === "color-hunt" ? Math.max(0, 9 - ownPhotoCount) : activity.type === "memory-capsule" ? 4 : 1;
      const selected = inputs.slice(0, limit);
      setUploadProgress(0);
      for (const [index, input] of selected.entries()) {
        attachments.push(await upload(input, (progress) => {
          setUploadProgress(Math.round(((index + progress / 100) / selected.length) * 100));
        }));
      }
      const action = activity.type === "color-hunt" ? "add-item" : "submit";
      const saved = await command({ ...message, activity }, action, {
        attachmentIds: attachments.map((attachment) => attachment.id),
        ...(text.trim() ? { caption: text.trim(), text: text.trim() } : {}),
        ...(activity.type === "memory-capsule" && secondary.trim() ? { songUrl: secondary.trim() } : {}),
      });
      if (activity.type === "color-hunt" && saved.activity) setDetailActivity(await activityQueries.detail(saved.activity.id));
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
      if (activity.type !== "color-hunt") onClose();
    } catch (next) {
      setError(userFacingError(next, t));
    } finally {
      setUploadProgress(null);
      setBusy(false);
    }
  };

  return (
    <>
      <Modal transparent visible statusBarTranslucent animationType="slide" onRequestClose={onClose}>
        <KeyboardAvoidingView style={styles.root} behavior="translate-with-padding" automaticOffset>
          <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: palette.overlay }]} onPress={busy ? undefined : onClose} />
          <View
            style={[
              styles.sheet,
              {
                paddingBottom: Math.max(insets.bottom, 14),
                backgroundColor: palette.elevated,
              },
            ]}
          >
            <View style={styles.header}>
              <View style={styles.headerCopy}>
                <Text style={[styles.title, { color: palette.text }]}>{typeLabel(activity.type, language)}</Text>
                {promptText(activity.config, language) && promptText(activity.config, language) !== typeLabel(activity.type, language) ? <Text style={[styles.headerInstruction, { color: palette.secondaryText }]}>{promptText(activity.config, language)}</Text> : null}
              </View>
              <Pressable accessibilityRole="button" accessibilityLabel={language === "ru" ? "Закрыть" : "Close"} disabled={busy} onPress={onClose} style={[styles.close, { backgroundColor: palette.surface }]}>
                <AppIcon name="close" size={21} color={palette.secondaryText} />
              </Pressable>
            </View>
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
              {needsDetail ? (
                detailLoading ? (
                  <ActivityIndicator color={palette.accent} />
                ) : (
                  <>
                    <Waiting text={language === "ru" ? "Не удалось загрузить детали. Обычные сообщения продолжают работать." : "Details could not be loaded. Regular messaging still works."} />
                    <Primary label={language === "ru" ? "Повторить" : "Retry"} disabled={false} busy={false} onPress={() => setDetailReload((value) => value + 1)} />
                  </>
                )
              ) : ["declined", "cancelled", "expired"].includes(activity.state) ? (
                <TerminalActivity state={activity.state} language={language} />
              ) : activity.state === "completed" || activity.state === "locked" ? (
                <ResultView message={{ ...message, activity }} />
              ) : activity.type === "question" ? (
                <QuestionInput value={text} onChange={setText} ownEntry={ownEntry} secret={activity.config.secret === true} onSubmit={() => void run("submit", { answer: text })} busy={busy} language={language} />
              ) : activity.type === "blitz" ? (
                ownSubmitted ? (
                  <Waiting text={language === "ru" ? "Твой блиц сохранён. Сравнение откроется после второго ответа." : "Your blitz is saved. The comparison unlocks after the other answer."} />
                ) : (
                  <BlitzInput prompts={activity.config.prompts} answers={answers} setAnswers={setAnswers} onSubmit={() => void run("submit", { answers })} busy={busy} language={language} />
                )
              ) : activity.type === "tiny-quest" || activity.type === "color-hunt" ? (
                activity.type === "tiny-quest" && ownSubmitted ? (
                  <Waiting text={language === "ru" ? "Твой снимок сохранён и пока скрыт. Ждём второй." : "Your photo is saved and stays hidden. Waiting for the other one."} />
                ) : (
                  <PhotoInput activityType={activity.type} text={text} onChange={setText} onPick={() => setPicker(true)} busy={busy} ownPhotos={activity.entries.filter((entry) => entry.createdBy === meId && entry.kind !== "collage").flatMap((entry) => entry.attachments)} ownCollage={activity.entries.find((entry) => entry.createdBy === meId && entry.kind === "collage")?.attachments[0]} assignedColor={activity.privateState.color} language={language} />
                )
              ) : activity.type === "song-exchange" ? (
                ownSubmitted ? (
                  <Waiting text={language === "ru" ? "Твоя песня сохранена. Пара откроется после второго выбора." : "Your song is saved. The pair unlocks after the other choice."} />
                ) : (
                  <SongInput title={text} setTitle={setText} url={secondary} setUrl={setSecondary} onSubmit={() => void run("submit", { title: text, url: secondary })} busy={busy} language={language} />
                )
              ) : activity.type === "movie-list" ? (
                <MovieList entries={activity.entries} participants={activity.participants} meId={meId} title={text} setTitle={setText} selected={selectedEntryId} setSelected={setSelectedEntryId} pickedId={typeof activity.result?.selectedEntryId === "string" ? activity.result.selectedEntryId : null} run={run} busy={busy} language={language} />
              ) : activity.type === "ideas-jar" ? (
                <IdeasJar entries={activity.entries} meId={meId} title={text} setTitle={setText} selectedId={typeof activity.result?.selectedEntryId === "string" ? activity.result.selectedEntryId : null} run={run} busy={busy} language={language} />
              ) : activity.type === "draw-guess" ? (
                <DrawGuess activityId={activity.id} drawerId={typeof activity.config.drawerId === "string" ? activity.config.drawerId : ""} meId={meId} drawing={drawing} liveDrawing={liveDrawing} setDrawing={handleDrawingChange} guess={text} setGuess={setText} run={run} busy={busy} language={language} privateState={activity.privateState} storedDrawing={activity.entries.find((entry) => entry.kind === "drawing")} attempts={activity.entries.filter((entry) => entry.kind === "guess")} />
              ) : activity.type === "memory-capsule" ? (
                ownSubmitted ? (
                  <Waiting text={language === "ru" ? "Твоя часть капсулы сохранена. После второго вклада она закроется." : "Your part is saved. The capsule locks after the other contribution."} />
                ) : (
                  <MemoryInput
                    text={text}
                    setText={setText}
                    songUrl={secondary}
                    setSongUrl={setSecondary}
                    onSubmit={() =>
                      void run("submit", {
                        text,
                        ...(secondary.trim() ? { songUrl: secondary.trim() } : {}),
                      })
                    }
                    onPick={() => setPicker(true)}
                    busy={busy}
                    language={language}
                  />
                )
              ) : null}
              {error ? (
                <Text accessibilityRole="alert" style={[styles.error, { color: palette.danger }]}>
                  {error}
                </Text>
              ) : null}
              {!["completed", "locked", "declined", "cancelled", "expired"].includes(activity.state) ? (
                <View style={styles.quietActions}>
                  <Pressable accessibilityRole="button" disabled={busy} onPress={() => void run("decline")}>
                    <Text style={[styles.quietText, { color: palette.secondaryText }]}>{language === "ru" ? "Не сейчас" : "Not now"}</Text>
                  </Pressable>
                  {activity.createdBy === meId ? (
                    <Pressable accessibilityRole="button" disabled={busy} onPress={() => void run("cancel")}>
                      <Text style={[styles.quietText, { color: palette.danger }]}>{language === "ru" ? "Отменить для обоих" : "Cancel for both"}</Text>
                    </Pressable>
                  ) : null}
                </View>
              ) : null}
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
        <ConfettiBurst visible={celebrating} />
      </Modal>
      <AttachmentSheet visible={picker} busy={busy} progress={uploadProgress} imagesOnly onClose={() => setPicker(false)} onSelect={uploadSelection} />
    </>
  );
}

function ConfettiBurst({ visible }: { visible: boolean }) {
  const progress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!visible) return;
    progress.setValue(0);
    Animated.timing(progress, {
      toValue: 1,
      duration: 1_250,
      useNativeDriver: true,
    }).start();
  }, [progress, visible]);
  if (!visible) return null;
  const colors = ["#7B4DFF", "#D7FF29", "#FF6FA3", "#2DE6B7", "#FF8A1F", "#4EB3FF"];
  return (
    <View pointerEvents="none" style={styles.confetti}>
      {Array.from({ length: 18 }, (_, index) => {
        const x = ((index % 9) - 4) * 25;
        const fall = 90 + (index % 3) * 22;
        return (
          <Animated.View
            key={index}
            style={[
              styles.confettiPiece,
              {
                backgroundColor: colors[index % colors.length],
                transform: [
                  {
                    translateX: progress.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0, x],
                    }),
                  },
                  {
                    translateY: progress.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0, fall],
                    }),
                  },
                  {
                    rotate: progress.interpolate({
                      inputRange: [0, 1],
                      outputRange: ["0deg", `${180 + index * 37}deg`],
                    }),
                  },
                ],
                opacity: progress.interpolate({
                  inputRange: [0, 0.72, 1],
                  outputRange: [1, 1, 0],
                }),
              },
            ]}
          />
        );
      })}
    </View>
  );
}

function typeLabel(type: string, language: "ru" | "en") {
  const labels: Record<string, [string, string]> = {
    question: ["Вопрос для двоих", "Question Drop"],
    blitz: ["Блиц", "60-Second Blitz"],
    "tiny-quest": ["Маленький квест", "Tiny Quest"],
    "color-hunt": ["Охота за цветом", "Color Hunt"],
    "song-exchange": ["Обмен песнями", "Song Exchange"],
    "movie-list": ["Наши фильмы", "Movie List"],
    "draw-guess": ["Нарисуй и угадай", "Draw & Guess"],
    "ideas-jar": ["Банка идей", "Ideas Jar"],
    "memory-capsule": ["Капсула памяти", "Memory Capsule"],
  };
  return labels[type]?.[language === "ru" ? 0 : 1] ?? type;
}
function promptText(config: Record<string, unknown>, language: "ru" | "en") {
  return localized(config.prompt ?? config.title, language);
}
