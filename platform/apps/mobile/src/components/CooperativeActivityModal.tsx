import type { CooperativeActivityEntry, CooperativeActivityParticipant, Message } from "@snezhok/contracts";
import * as Haptics from "expo-haptics";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Linking, Modal, PanResponder, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import Svg, { Path } from "react-native-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { usePalette } from "../hooks/usePalette";
import { useTranslation } from "../i18n";
import { api } from "../lib/api";
import { clearRealtimeDrawing, emitRealtimeDrawing, subscribeRealtimeDrawing } from "../lib/realtimeBridge";
import { userFacingError } from "../lib/userFacingError";
import { useAppStore } from "../store/useAppStore";
import type { UploadInput } from "../types";
import { AppIcon } from "./AppIcon";
import { useAppDialog } from "./AppDialogProvider";
import { AuthenticatedImage } from "./AuthenticatedImage";
import { AttachmentSheet } from "./AttachmentSheet";

export function CooperativeActivityModal({ message, onClose }: { message: Message | null; onClose: () => void }) {
  const summaryActivity = message?.activity;
  const palette = usePalette();
  const { language, t } = useTranslation();
  const insets = useSafeAreaInsets();
  const meId = useAppStore((state) => state.me?.id);
  const command = useAppStore((state) => state.commandActivity);
  const upload = useAppStore((state) => state.uploadAttachment);
  const uploadProgress = useAppStore((state) => state.uploadProgress);
  const [busy, setBusy] = useState(false);
  const [picker, setPicker] = useState(false);
  const [text, setText] = useState("");
  const [secondary, setSecondary] = useState("");
  const [answers, setAnswers] = useState<Array<"left" | "right" | null>>([]);
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
  const [drawing, setDrawing] = useState<number[][][]>([]);
  const [liveDrawing, setLiveDrawing] = useState<number[][][]>([]);
  const [error, setError] = useState<string | null>(null);
  const [detailActivity, setDetailActivity] = useState(summaryActivity?.detail === "full" ? summaryActivity : null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailReload, setDetailReload] = useState(0);
  const activity = summaryActivity && detailActivity?.id === summaryActivity.id && detailActivity.revision >= summaryActivity.revision ? detailActivity : summaryActivity;
  const drawingActivityId = summaryActivity?.type === "draw-guess" ? summaryActivity.id : null;
  const expectedCollages = activity?.type === "color-hunt" ? activity.participants.filter((participant) => participant.contributionCount >= 9 || ["submitted", "completed"].includes(participant.status)).length : 0;
  const readyCollages = activity?.type === "color-hunt" ? activity.entries.filter((entry) => entry.kind === "collage" && entry.attachments.length > 0).length : 0;
  const handleDrawingChange = useCallback((next: number[][][]) => {
    setDrawing(next);
    if (drawingActivityId && message?.streamId) emitRealtimeDrawing(message.streamId, drawingActivityId, next);
  }, [drawingActivityId, message?.streamId]);

  useEffect(() => {
    setText(""); setSecondary(""); setSelectedEntryId(null); setDrawing([]); setLiveDrawing([]); setError(null);
    const count = Array.isArray(activity?.config.prompts) ? activity.config.prompts.length : 0;
    setAnswers(Array.from({ length: count }, () => null));
  }, [summaryActivity?.id]);

  useEffect(() => drawingActivityId ? subscribeRealtimeDrawing(drawingActivityId, setLiveDrawing) : undefined, [drawingActivityId]);

  useEffect(() => {
    if (!activity || activity.type !== "color-hunt") return;
    if (!expectedCollages || readyCollages >= expectedCollages) return;
    let active = true;
    let attempts = 0;
    const timer = setInterval(() => {
      if (!active || attempts >= 30) { clearInterval(timer); return; }
      attempts += 1;
      void api.activity(activity.id).then((next) => { if (active) setDetailActivity(next); }).catch(() => undefined);
    }, 1_000);
    return () => { active = false; clearInterval(timer); };
  }, [activity?.id, activity?.revision, activity?.type, expectedCollages, readyCollages]);

  useEffect(() => {
    if (!summaryActivity || summaryActivity.detail !== "summary") { setDetailActivity(summaryActivity ?? null); setDetailLoading(false); return; }
    let current = true;
    setDetailActivity(null); setDetailLoading(true);
    void api.activity(summaryActivity.id).then((detail) => { if (current && detail.revision === summaryActivity.revision) setDetailActivity(detail); }).catch((next) => { if (current) setError(userFacingError(next, t)); }).finally(() => { if (current) setDetailLoading(false); });
    return () => { current = false; };
  }, [summaryActivity?.id, summaryActivity?.revision, summaryActivity?.detail, detailReload, t]);

  if (!message || !summaryActivity || !activity) return null;
  const ownEntry = activity.entries.find((entry) => entry.createdBy === meId);
  const ownParticipant = activity.participants.find((participant) => participant.user.id === meId);
  const ownSubmitted = Boolean(ownEntry) || Boolean(ownParticipant && ["submitted", "completed"].includes(ownParticipant.status));
  const needsDetail = summaryActivity.detail === "summary" && (!detailActivity || detailActivity.revision < summaryActivity.revision);
  const run = async (action: string, payload: Record<string, unknown> = {}) => {
    if (busy) return false;
    setBusy(true); setError(null);
    try {
      const saved = await command({ ...message, activity }, action, payload);
      if (["movie-list", "ideas-jar", "color-hunt", "draw-guess"].includes(activity.type) && saved.activity) setDetailActivity(await api.activity(saved.activity.id));
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
      if (!["movie-list", "ideas-jar", "color-hunt", "draw-guess"].includes(activity.type)) onClose();
      return true;
    } catch (next) {
      setError(userFacingError(next, t));
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => undefined);
      return false;
    } finally { setBusy(false); }
  };

  const uploadSelection = async (inputs: UploadInput[]) => {
    setPicker(false); setBusy(true); setError(null);
    try {
      const attachments = [];
      for (const input of inputs.slice(0, activity.type === "memory-capsule" ? 4 : 1)) attachments.push(await upload(input));
      const action = activity.type === "color-hunt" ? "add-item" : "submit";
      const saved = await command({ ...message, activity }, action, { attachmentIds: attachments.map((attachment) => attachment.id), ...(text.trim() ? { caption: text.trim(), text: text.trim() } : {}), ...(activity.type === "memory-capsule" && secondary.trim() ? { songUrl: secondary.trim() } : {}) });
      if (activity.type === "color-hunt" && saved.activity) setDetailActivity(await api.activity(saved.activity.id));
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
      if (activity.type !== "color-hunt") onClose();
    } catch (next) { setError(userFacingError(next, t)); }
    finally { setBusy(false); }
  };

  return <>
    <Modal transparent visible statusBarTranslucent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.root} behavior="translate-with-padding" automaticOffset>
        <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: palette.overlay }]} onPress={busy ? undefined : onClose} />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 14), backgroundColor: palette.elevated }]}>
          <View style={styles.header}><View><Text style={[styles.eyebrow, { color: palette.accent }]}>{typeLabel(activity.type, language)}</Text><Text style={[styles.title, { color: palette.text }]}>{promptText(activity.config, language) || typeLabel(activity.type, language)}</Text></View><Pressable accessibilityRole="button" accessibilityLabel={language === "ru" ? "Закрыть" : "Close"} disabled={busy} onPress={onClose} style={[styles.close, { backgroundColor: palette.surface }]}><AppIcon name="close" size={21} color={palette.secondaryText} /></Pressable></View>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
            {needsDetail ? detailLoading ? <ActivityIndicator color={palette.accent} /> : <><Waiting text={language === "ru" ? "Не удалось загрузить детали. Обычные сообщения продолжают работать." : "Details could not be loaded. Regular messaging still works."} /><Primary label={language === "ru" ? "Повторить" : "Retry"} disabled={false} busy={false} onPress={() => setDetailReload((value) => value + 1)} /></> : ["declined", "cancelled", "expired"].includes(activity.state) ? <TerminalActivity state={activity.state} language={language} /> : activity.state === "completed" || activity.state === "locked" ? <ResultView message={{ ...message, activity }} /> : activity.type === "question" ? <QuestionInput value={text} onChange={setText} ownEntry={ownEntry} secret={activity.config.secret === true} onSubmit={() => void run("submit", { answer: text })} busy={busy} language={language} />
              : activity.type === "blitz" ? ownSubmitted ? <Waiting text={language === "ru" ? "Твой блиц сохранён. Сравнение откроется после второго ответа." : "Your blitz is saved. The comparison unlocks after the other answer."} /> : <BlitzInput prompts={activity.config.prompts} answers={answers} setAnswers={setAnswers} onSubmit={() => void run("submit", { answers })} busy={busy} language={language} />
              : activity.type === "tiny-quest" || activity.type === "color-hunt" ? activity.type === "tiny-quest" && ownSubmitted ? <Waiting text={language === "ru" ? "Твой снимок сохранён и пока скрыт. Ждём второй." : "Your photo is saved and stays hidden. Waiting for the other one."} /> : <PhotoInput activityType={activity.type} text={text} onChange={setText} onPick={() => setPicker(true)} busy={busy} ownPhotos={activity.entries.filter((entry) => entry.createdBy === meId && entry.kind !== "collage").flatMap((entry) => entry.attachments)} ownCollage={activity.entries.find((entry) => entry.createdBy === meId && entry.kind === "collage")?.attachments[0]} language={language} />
              : activity.type === "song-exchange" ? ownSubmitted ? <Waiting text={language === "ru" ? "Твоя песня сохранена. Пара откроется после второго выбора." : "Your song is saved. The pair unlocks after the other choice."} /> : <SongInput title={text} setTitle={setText} url={secondary} setUrl={setSecondary} onSubmit={() => void run("submit", { title: text, url: secondary })} busy={busy} language={language} />
              : activity.type === "movie-list" ? <MovieList entries={activity.entries} participants={activity.participants} meId={meId} title={text} setTitle={setText} selected={selectedEntryId} setSelected={setSelectedEntryId} pickedId={typeof activity.result?.selectedEntryId === "string" ? activity.result.selectedEntryId : null} run={run} busy={busy} language={language} />
              : activity.type === "ideas-jar" ? <IdeasJar entries={activity.entries} meId={meId} title={text} setTitle={setText} selectedId={typeof activity.result?.selectedEntryId === "string" ? activity.result.selectedEntryId : null} run={run} busy={busy} language={language} />
              : activity.type === "draw-guess" ? <DrawGuess activityId={activity.id} drawerId={typeof activity.config.drawerId === "string" ? activity.config.drawerId : ""} meId={meId} drawing={drawing} liveDrawing={liveDrawing} setDrawing={handleDrawingChange} guess={text} setGuess={setText} run={run} busy={busy} language={language} privateState={activity.privateState} storedDrawing={activity.entries.find((entry) => entry.kind === "drawing")} attempts={activity.entries.filter((entry) => entry.kind === "guess")} />
              : activity.type === "memory-capsule" ? ownSubmitted ? <Waiting text={language === "ru" ? "Твоя часть капсулы сохранена. После второго вклада она закроется." : "Your part is saved. The capsule locks after the other contribution."} /> : <MemoryInput text={text} setText={setText} songUrl={secondary} setSongUrl={setSecondary} onSubmit={() => void run("submit", { text, ...(secondary.trim() ? { songUrl: secondary.trim() } : {}) })} onPick={() => setPicker(true)} busy={busy} language={language} /> : null}
            {error ? <Text accessibilityRole="alert" style={[styles.error, { color: palette.danger }]}>{error}</Text> : null}
            {!["completed", "locked", "declined", "cancelled", "expired"].includes(activity.state) ? <View style={styles.quietActions}><Pressable accessibilityRole="button" disabled={busy} onPress={() => void run("decline")}><Text style={[styles.quietText, { color: palette.secondaryText }]}>{language === "ru" ? "Не сейчас" : "Not now"}</Text></Pressable>{activity.createdBy === meId ? <Pressable accessibilityRole="button" disabled={busy} onPress={() => void run("cancel")}><Text style={[styles.quietText, { color: palette.danger }]}>{language === "ru" ? "Отменить для обоих" : "Cancel for both"}</Text></Pressable> : null}</View> : null}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
    <AttachmentSheet visible={picker} busy={busy} progress={uploadProgress} imagesOnly onClose={() => setPicker(false)} onSelect={uploadSelection} />
  </>;
}

function QuestionInput({ value, onChange, ownEntry, secret, onSubmit, busy, language }: { value: string; onChange: (value: string) => void; ownEntry?: CooperativeActivityEntry | undefined; secret: boolean; onSubmit: () => void; busy: boolean; language: "ru" | "en" }) {
  const palette = usePalette();
  if (ownEntry) return <Waiting text={secret ? (language === "ru" ? "Твой ответ сохранён. Ответ другого человека останется скрыт до общего открытия." : "Your answer is saved. The other answer stays hidden until the shared reveal.") : (language === "ru" ? "Твой ответ уже в чате. Ждём второй ответ." : "Your answer is in the chat. Waiting for the other answer.")} />;
  return <><TextInput multiline autoFocus value={value} onChangeText={onChange} maxLength={4_000} placeholder={language === "ru" ? "Твой честный ответ…" : "Your honest answer…"} placeholderTextColor={palette.faintText} style={[styles.largeInput, { color: palette.text, backgroundColor: palette.surface, borderColor: palette.border }]} /><Primary label={secret ? (language === "ru" ? "Ответить тайно" : "Answer secretly") : (language === "ru" ? "Ответить" : "Answer")} disabled={busy || !value.trim()} busy={busy} onPress={onSubmit} /></>;
}

function BlitzInput({ prompts, answers, setAnswers, onSubmit, busy, language }: { prompts: unknown; answers: Array<"left" | "right" | null>; setAnswers: (value: Array<"left" | "right" | null>) => void; onSubmit: () => void; busy: boolean; language: "ru" | "en" }) {
  const palette = usePalette(); const list = Array.isArray(prompts) ? prompts as Array<Record<string, unknown>> : [];
  return <>{list.map((prompt, index) => <View key={String(prompt.id ?? index)} style={styles.blitzRow}><Choice label={localized(prompt.left, language)} active={answers[index] === "left"} onPress={() => setAnswers(answers.map((answer, i) => i === index ? "left" : answer))} /><Text style={[styles.or, { color: palette.faintText }]}>·</Text><Choice label={localized(prompt.right, language)} active={answers[index] === "right"} onPress={() => setAnswers(answers.map((answer, i) => i === index ? "right" : answer))} /></View>)}<Primary label={language === "ru" ? "Готово" : "Done"} disabled={busy || answers.some((answer) => answer === null)} busy={busy} onPress={onSubmit} /></>;
}

function PhotoInput({ activityType, text, onChange, onPick, busy, ownPhotos, ownCollage, language }: { activityType: string; text: string; onChange: (v: string) => void; onPick: () => void; busy: boolean; ownPhotos: CooperativeActivityEntry["attachments"]; ownCollage?: CooperativeActivityEntry["attachments"][number] | undefined; language: "ru" | "en" }) {
  const palette = usePalette();
  const ownCount = ownPhotos.length;
  return <><Text style={[styles.explainer, { color: palette.secondaryText }]}>{activityType === "color-hunt" ? (ownCount >= 9 ? (ownCollage ? (language === "ru" ? "Твой коллаж готов. Ждём вторую доску." : "Your collage is ready. Waiting for the other board.") : (language === "ru" ? "Собираем один большой коллаж…" : "Building one large collage…")) : (language === "ru" ? `Твоя доска: ${ownCount}/9. Снимай только предметы назначенного цвета.` : `Your board: ${ownCount}/9. Photograph only objects in your assigned colour.`)) : (language === "ru" ? "Ваши снимки откроются только после вклада обоих." : "Your photos unlock only after both people contribute.")}</Text>{activityType === "color-hunt" ? ownCollage ? <CollagePhoto attachment={ownCollage} /> : <CollageGrid attachments={ownPhotos} /> : <TextInput value={text} onChangeText={onChange} maxLength={500} placeholder={language === "ru" ? "Подпись — необязательно" : "Optional caption"} placeholderTextColor={palette.faintText} style={[styles.input, { color: palette.text, backgroundColor: palette.surface }]} />}<Primary label={activityType === "color-hunt" ? (language === "ru" ? "Снять или выбрать фото" : "Take or choose a photo") : (language === "ru" ? "Выбрать фото" : "Choose photo")} disabled={busy || ownCount >= 9} busy={busy} onPress={onPick} /></>;
}

function SongInput({ title, setTitle, url, setUrl, onSubmit, busy, language }: { title: string; setTitle: (v: string) => void; url: string; setUrl: (v: string) => void; onSubmit: () => void; busy: boolean; language: "ru" | "en" }) {
  const palette = usePalette(); return <><Text style={[styles.explainer, { color: palette.secondaryText }]}>{language === "ru" ? "В Яндекс Музыке нажми «Поделиться» и вставь ссылку — карточка откроется прямо в приложении Музыки." : "Use Share in Yandex Music and paste the link—the card opens directly in the Music app."}</Text><TextInput value={title} onChangeText={setTitle} maxLength={200} placeholder={language === "ru" ? "Название песни" : "Song title"} placeholderTextColor={palette.faintText} style={[styles.input, { color: palette.text, backgroundColor: palette.surface }]} /><TextInput value={url} onChangeText={setUrl} autoCapitalize="none" keyboardType="url" maxLength={2_048} placeholder="https://music.yandex.ru/…" placeholderTextColor={palette.faintText} style={[styles.input, { color: palette.text, backgroundColor: palette.surface }]} /><Primary label={language === "ru" ? "Добавить песню" : "Add song"} disabled={busy || !title.trim() || !url.trim()} busy={busy} onPress={onSubmit} /></>;
}

function MovieList({ entries, participants, meId, title, setTitle, selected, setSelected, pickedId, run, busy, language }: { entries: CooperativeActivityEntry[]; participants: CooperativeActivityParticipant[]; meId?: string | undefined; title: string; setTitle: (v: string) => void; selected: string | null; setSelected: (v: string | null) => void; pickedId: string | null; run: (a: string, p?: Record<string, unknown>) => Promise<boolean>; busy: boolean; language: "ru" | "en" }) {
  const palette = usePalette();
  const showDialog = useAppDialog();
  const picked = entries.find((entry) => entry.id === pickedId);
  const confirmRemove = (entry: CooperativeActivityEntry) => showDialog(
    language === "ru" ? "Удалить фильм?" : "Remove movie?",
    String(entry.payload.title ?? ""),
    [{ text: language === "ru" ? "Отмена" : "Cancel", style: "cancel" }, { text: language === "ru" ? "Удалить" : "Remove", style: "destructive", onPress: () => void run("remove-item", { entryId: entry.id }) }],
  );
  return <><View style={styles.addLine}>
    <TextInput accessibilityLabel={language === "ru" ? "Добавить фильм" : "Add a movie"} value={title} onChangeText={setTitle} maxLength={200} placeholder={language === "ru" ? "Добавить фильм" : "Add a movie"} placeholderTextColor={palette.faintText} style={[styles.inlineInput, { color: palette.text, backgroundColor: palette.surface }]} />
    <Pressable accessibilityRole="button" accessibilityLabel={language === "ru" ? "Добавить фильм" : "Add movie"} disabled={!title.trim() || busy} onPress={() => { void run("add-item", { title }).then((saved) => { if (saved) setTitle(""); }); }} style={[styles.plus, { backgroundColor: palette.accent }]}><AppIcon name="add" size={22} color="#FFF" /></Pressable>
  </View>{picked ? <View style={[styles.picked, { backgroundColor: palette.accentSoft }]}>
    <Text style={[styles.itemMeta, { color: palette.accent }]}>{language === "ru" ? "Сегодня смотрим" : "Tonight's pick"}</Text>
    <Text style={[styles.pickedTitle, { color: palette.text }]}>{String(picked.payload.title ?? "")}</Text>
    <View style={styles.pickActions}><Pressable accessibilityRole="button" disabled={busy} onPress={() => void run("reroll")}><Text style={{ color: palette.accent, fontWeight: "700" }}>{language === "ru" ? "Перевыбрать" : "Reroll"}</Text></Pressable><Pressable accessibilityRole="button" disabled={busy} onPress={() => void run("confirm", { entryId: picked.id, status: "watched" })}><Text style={{ color: palette.success, fontWeight: "800" }}>{language === "ru" ? "Посмотрели" : "Watched"}</Text></Pressable></View>
  </View> : null}{entries.map((entry) => <View key={entry.id} style={[styles.listItem, { borderColor: palette.border }]}>
    <Pressable accessibilityRole="button" accessibilityLabel={String(entry.payload.title ?? "")} style={styles.flex} onPress={() => setSelected(selected === entry.id ? null : entry.id)}><Text style={[styles.itemTitle, { color: palette.text }]}>{String(entry.payload.title ?? "")}</Text><Text style={[styles.itemMeta, { color: palette.secondaryText }]}>{entry.payload.combinedRating ? `${entry.payload.combinedRating}/10` : (language === "ru" ? "Без оценки" : "Not rated")} · {entry.payload.status === "watched" ? (language === "ru" ? "просмотрено" : "watched") : (language === "ru" ? "хотим посмотреть" : "want to watch")}</Text>{ratingLabels(entry.payload.ratings, participants).map((label) => <Text key={label} style={[styles.itemMeta, { color: palette.secondaryText }]}>{label}</Text>)}</Pressable>
    <Pressable accessibilityRole="button" accessibilityLabel={language === "ru" ? "Изменить статус просмотра" : "Change watched status"} disabled={busy} onPress={() => void run("set-status", { entryId: entry.id, status: entry.payload.status === "watched" ? "want" : "watched" })} style={iconActionStyle}><AppIcon name="checkmark" size={20} color={palette.accent} /></Pressable>
    {entry.createdBy === meId ? <Pressable accessibilityRole="button" accessibilityLabel={language === "ru" ? "Удалить фильм" : "Remove movie"} disabled={busy} onPress={() => confirmRemove(entry)} style={iconActionStyle}><AppIcon name="trash-outline" size={19} color={palette.danger} /></Pressable> : null}
    {selected === entry.id ? <View style={styles.ratings}>{Array.from({ length: 10 }, (_, i) => i + 1).map((rating) => <Pressable accessibilityRole="button" accessibilityLabel={String(rating)} key={rating} onPress={() => { setSelected(null); void run("rate", { entryId: entry.id, rating }); }} style={[styles.rating, { backgroundColor: palette.accentSoft }]}><Text style={{ color: palette.accent, fontWeight: "800" }}>{rating}</Text></Pressable>)}</View> : null}
  </View>)}<Primary label={picked ? (language === "ru" ? "Другой случайный фильм" : "Pick another") : (language === "ru" ? "Выбрать случайный фильм" : "Pick a random movie")} disabled={busy || !entries.some((entry) => entry.payload.status === "want")} busy={busy} onPress={() => void run(picked ? "reroll" : "pick")} /></>;
}

function ratingLabels(value: unknown, participants: CooperativeActivityParticipant[]) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.entries(value as Record<string, unknown>).flatMap(([userId, rating]) => typeof rating === "number" ? [`${participants.find((participant) => participant.user.id === userId)?.user.displayName ?? "—"}: ${rating}/10`] : []);
}

function IdeasJar({ entries, meId, title, setTitle, selectedId, run, busy, language }: { entries: CooperativeActivityEntry[]; meId?: string | undefined; title: string; setTitle: (v: string) => void; selectedId: string | null; run: (a: string, p?: Record<string, unknown>) => Promise<boolean>; busy: boolean; language: "ru" | "en" }) {
  const palette = usePalette();
  const showDialog = useAppDialog();
  const confirmRemove = (entry: CooperativeActivityEntry) => showDialog(
    language === "ru" ? "Удалить идею?" : "Remove idea?",
    String(entry.payload.title ?? ""),
    [{ text: language === "ru" ? "Отмена" : "Cancel", style: "cancel" }, { text: language === "ru" ? "Удалить" : "Remove", style: "destructive", onPress: () => void run("remove-item", { entryId: entry.id }) }],
  );
  return <><View style={styles.addLine}><TextInput accessibilityLabel={language === "ru" ? "Новая идея" : "New idea"} value={title} onChangeText={setTitle} maxLength={240} placeholder={language === "ru" ? "Новая идея" : "New idea"} placeholderTextColor={palette.faintText} style={[styles.inlineInput, { color: palette.text, backgroundColor: palette.surface }]} /><Pressable accessibilityRole="button" accessibilityLabel={language === "ru" ? "Добавить идею" : "Add idea"} disabled={!title.trim() || busy} onPress={() => { void run("add-item", { title }).then((saved) => { if (saved) setTitle(""); }); }} style={[styles.plus, { backgroundColor: palette.accent }]}><AppIcon name="add" size={22} color="#FFF" /></Pressable></View>{selectedId ? <View style={[styles.picked, { backgroundColor: palette.accentSoft }]}><Text style={[styles.itemMeta, { color: palette.accent }]}>{language === "ru" ? "Сегодня выбираем" : "Today's pick"}</Text><Text style={[styles.pickedTitle, { color: palette.text }]}>{String(entries.find((entry) => entry.id === selectedId)?.payload.title ?? "")}</Text><View style={styles.pickActions}><Pressable accessibilityRole="button" disabled={busy} onPress={() => void run("reroll")}><Text style={{ color: palette.accent, fontWeight: "700" }}>{language === "ru" ? "Ещё раз" : "Reroll"}</Text></Pressable><Pressable accessibilityRole="button" disabled={busy} onPress={() => void run("complete", { entryId: selectedId })}><Text style={{ color: palette.success, fontWeight: "800" }}>{language === "ru" ? "Сделали" : "Done"}</Text></Pressable></View></View> : null}{entries.map((entry) => <View key={entry.id} style={[styles.listItem, { borderColor: palette.border }]}><Text style={[styles.flex, styles.itemTitle, { color: palette.text, textDecorationLine: entry.payload.status === "done" ? "line-through" : "none" }]}>{String(entry.payload.title ?? "")}</Text>{entry.createdBy === meId ? <Pressable accessibilityRole="button" accessibilityLabel={language === "ru" ? "Удалить идею" : "Remove idea"} disabled={busy} onPress={() => confirmRemove(entry)} style={iconActionStyle}><AppIcon name="trash-outline" size={19} color={palette.danger} /></Pressable> : null}</View>)}<Primary label={language === "ru" ? "Вытянуть идею" : "Pick an idea"} disabled={busy || !entries.some((entry) => entry.payload.status === "planned")} busy={busy} onPress={() => void run("pick")} /></>;
}

function DrawGuess({ activityId, drawerId, meId, drawing, liveDrawing, setDrawing, guess, setGuess, run, busy, language, privateState, storedDrawing, attempts }: { activityId: string; drawerId: string; meId?: string | undefined; drawing: number[][][]; liveDrawing: number[][][]; setDrawing: (v: number[][][]) => void; guess: string; setGuess: (v: string) => void; run: (a: string, p?: Record<string, unknown>) => Promise<boolean>; busy: boolean; language: "ru" | "en"; privateState: Record<string, unknown>; storedDrawing?: CooperativeActivityEntry | undefined; attempts: CooperativeActivityEntry[] }) {
  const palette = usePalette(); const drawer = drawerId === meId;
  const saved = Array.isArray(storedDrawing?.payload.strokes) ? storedDrawing.payload.strokes as number[][][] : [];
  if (drawer && storedDrawing) return <><ReadOnlyDrawing strokes={saved} /><Waiting text={language === "ru" ? "Рисунок отправлен. Теперь очередь угадывающего." : "Drawing sent. Now it is the guesser's turn."} /><GuessAttempts attempts={attempts} language={language} /></>;
  if (drawer) return <><Text style={[styles.explainer, { color: palette.secondaryText }]}>{language === "ru" ? "Нарисуй: " : "Draw: "}<Text style={{ color: palette.text, fontWeight: "800" }}>{localized(privateState.word, language)}</Text></Text><DrawingCanvas strokes={drawing} onChange={setDrawing} /><View style={styles.pickActions}><Pressable onPress={() => setDrawing([])}><Text style={{ color: palette.secondaryText }}>{language === "ru" ? "Очистить" : "Clear"}</Text></Pressable></View><Primary label={language === "ru" ? "Готово" : "Done"} disabled={busy || !drawing.length} busy={busy} onPress={() => void run("submit-drawing", { strokes: drawing, width: 300, height: 240 }).then((savedResult) => { if (savedResult) clearRealtimeDrawing(activityId); })} /></>;
  const visibleDrawing = saved.length ? saved : liveDrawing;
  return <><ReadOnlyDrawing strokes={visibleDrawing} />{!storedDrawing ? <Text style={[styles.liveLabel, { color: palette.secondaryText }]}>{visibleDrawing.length ? (language === "ru" ? "Художник рисует прямо сейчас…" : "The artist is drawing live…") : (language === "ru" ? "Ждём первый штрих…" : "Waiting for the first stroke…")}</Text> : <><GuessAttempts attempts={attempts} language={language} /><TextInput accessibilityLabel={language === "ru" ? "Твоя догадка" : "Your guess"} value={guess} onChangeText={setGuess} maxLength={100} placeholder={language === "ru" ? "Твоя догадка" : "Your guess"} placeholderTextColor={palette.faintText} style={[styles.input, { color: palette.text, backgroundColor: palette.surface }]} /><Primary label={language === "ru" ? "Угадать" : "Guess"} disabled={busy || !guess.trim()} busy={busy} onPress={() => void run("guess", { guess }).then((savedResult) => { if (savedResult) setGuess(""); })} /></>}</>;
}

function GuessAttempts({ attempts, language }: { attempts: CooperativeActivityEntry[]; language: "ru" | "en" }) {
  const palette = usePalette();
  if (!attempts.length) return null;
  return <View accessibilityLiveRegion="polite" style={{ marginTop: 10 }}>{attempts.slice(-3).map((attempt) => <View key={attempt.id} style={attemptStyle}><AppIcon name={attempt.payload.correct ? "checkmark" : "close"} size={16} color={attempt.payload.correct ? palette.success : palette.danger} /><Text numberOfLines={1} style={[styles.flex, styles.itemMeta, { color: palette.secondaryText }]}>{String(attempt.payload.guess ?? (language === "ru" ? "Попытка" : "Attempt"))}</Text></View>)}</View>;
}

function DrawingCanvas({ strokes, onChange }: { strokes: number[][][]; onChange: (value: number[][][]) => void }) {
  const current = useRef<number[][]>([]); const strokesRef = useRef(strokes); const base = useRef<number[][][]>([]); const size = useRef({ width: 300, height: 240 }); strokesRef.current = strokes;
  const point = (x: number, y: number): [number, number] => [Math.round(Math.max(0, Math.min(300, x / size.current.width * 300)) * 10) / 10, Math.round(Math.max(0, Math.min(240, y / size.current.height * 240)) * 10) / 10];
  const responder = useMemo(() => PanResponder.create({ onStartShouldSetPanResponder: () => true, onMoveShouldSetPanResponder: () => true, onPanResponderGrant: (event) => { base.current = strokesRef.current.slice(0, 199); current.current = [point(event.nativeEvent.locationX, event.nativeEvent.locationY)]; }, onPanResponderMove: (event) => { const total = base.current.reduce((count, stroke) => count + stroke.length, 0) + current.current.length; if (current.current.length >= 500 || total >= 2_000) return; const next = point(event.nativeEvent.locationX, event.nativeEvent.locationY); const previous = current.current.at(-1)!; if (Math.hypot(next[0]! - previous[0]!, next[1]! - previous[1]!) < 1.5) return; current.current.push(next); onChange([...base.current, [...current.current]]); }, onPanResponderRelease: () => { if (current.current.length === 1) { const first = current.current[0]!; const x = first[0] ?? 0; const y = first[1] ?? 0; onChange([...base.current, [[x, y], [Math.min(300, x + 0.5), y]]]); } current.current = []; base.current = strokesRef.current; } }), [onChange]);
  return <View accessible accessibilityRole="image" accessibilityLabel="Drawing canvas" onLayout={(event) => { size.current = { width: Math.max(1, event.nativeEvent.layout.width), height: Math.max(1, event.nativeEvent.layout.height) }; }} {...responder.panHandlers} style={styles.canvas}><Svg width="100%" height="100%" viewBox="0 0 300 240">{strokes.map((stroke, index) => <Path key={index} d={stroke.map((coordinate, i) => `${i ? "L" : "M"}${coordinate[0] ?? 0} ${coordinate[1] ?? 0}`).join(" ")} stroke="#19202A" strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" fill="none" />)}</Svg></View>;
}

function MemoryInput({ text, setText, songUrl, setSongUrl, onSubmit, onPick, busy, language }: { text: string; setText: (v: string) => void; songUrl: string; setSongUrl: (v: string) => void; onSubmit: () => void; onPick: () => void; busy: boolean; language: "ru" | "en" }) {
  const palette = usePalette(); return <><Text style={[styles.explainer, { color: palette.secondaryText }]}>{language === "ru" ? "Добавь сообщение, фото или песню. После вклада обоих капсула закроется до даты открытия." : "Add a note, photo, or song. Once both contribute, the capsule locks until reveal day."}</Text><TextInput multiline value={text} onChangeText={setText} maxLength={4_000} placeholder={language === "ru" ? "Что хочется сохранить?" : "What should be remembered?"} placeholderTextColor={palette.faintText} style={[styles.largeInput, { color: palette.text, backgroundColor: palette.surface, borderColor: palette.border }]} /><TextInput value={songUrl} onChangeText={setSongUrl} autoCapitalize="none" keyboardType="url" maxLength={2_048} placeholder={language === "ru" ? "Ссылка на песню — необязательно" : "Optional song link"} placeholderTextColor={palette.faintText} style={[styles.input, { color: palette.text, backgroundColor: palette.surface }]} /><View style={styles.twoActions}><Pressable disabled={busy} onPress={onPick} style={[styles.secondaryButton, { backgroundColor: palette.surface }]}><AppIcon name="images-outline" size={20} color={palette.accent} /><Text style={{ color: palette.accent, fontWeight: "800" }}>{language === "ru" ? "Фото" : "Photo"}</Text></Pressable><Pressable disabled={busy || (!text.trim() && !songUrl.trim())} onPress={onSubmit} style={[styles.primarySmall, { backgroundColor: palette.accent, opacity: !text.trim() && !songUrl.trim() ? 0.45 : 1 }]}><Text style={styles.actionText}>{language === "ru" ? "Сохранить" : "Save"}</Text></Pressable></View></>;
}

function TerminalActivity({ state, language }: { state: string; language: "ru" | "en" }) {
  const palette = usePalette();
  const copy = state === "declined"
    ? (language === "ru" ? "Участие отклонено. Сохранённые материалы больше не раскрываются." : "Participation was declined. Saved contributions will not be revealed.")
    : state === "expired"
      ? (language === "ru" ? "Это действие завершилось по времени." : "This activity has expired.")
      : (language === "ru" ? "Создатель отменил это действие для обоих." : "The creator cancelled this activity for both people.");
  return <View accessibilityRole="summary" style={[styles.waiting, { backgroundColor: palette.surface }]}><AppIcon name="warning-outline" size={28} color={palette.secondaryText} /><Text style={[styles.explainer, { color: palette.secondaryText, textAlign: "center" }]}>{copy}</Text></View>;
}

function ResultView({ message }: { message: Message }) {
  const activity = message.activity!; const palette = usePalette(); const { language } = useTranslation();
  if (activity.state === "locked") return <View style={styles.waiting}><AppIcon name="lock-closed-outline" size={34} color={palette.accent} /><Text style={[styles.resultTitle, { color: palette.text, textAlign: "center" }]}>{language === "ru" ? "Капсула надёжно закрыта" : "The capsule is safely locked"}</Text><Text style={[styles.explainer, { color: palette.secondaryText, textAlign: "center" }]}>{activity.revealAt ? new Date(activity.revealAt).toLocaleString(language === "ru" ? "ru-RU" : "en-US") : ""}</Text></View>;
  if (activity.type === "blitz") return <BlitzResult entries={activity.entries} prompts={activity.config.prompts} language={language} />;
  if (activity.type === "memory-capsule") return <MemoryResult entries={activity.entries} language={language} />;
  if (activity.type === "color-hunt") return <><Text style={[styles.resultTitle, { color: palette.text }]}>{language === "ru" ? "Два цветных коллажа" : "Two colour collages"}</Text>{activity.participants.map((participant) => { const collage = activity.entries.find((entry) => entry.createdBy === participant.user.id && entry.kind === "collage")?.attachments[0]; const photos = activity.entries.filter((entry) => entry.createdBy === participant.user.id && entry.kind === "photo").flatMap((entry) => entry.attachments); return <View key={participant.user.id} style={styles.collageResult}><Text style={[styles.itemTitle, { color: palette.text }]}>{participant.user.displayName}</Text>{collage ? <CollagePhoto attachment={collage} /> : <CollageGrid attachments={photos} />}</View>; })}</>;
  if (activity.type === "tiny-quest") return <><Text style={[styles.resultTitle, { color: palette.text }]}>{language === "ru" ? "Открыто вместе" : "Revealed together"}</Text><View style={styles.resultMedia}>{activity.entries.flatMap((entry) => entry.attachments).map((attachment) => <ResultPhoto key={attachment.id} url={attachment.thumbnailUrl ?? attachment.url} />)}</View>{activity.entries.map((entry) => entry.payload.text || entry.payload.caption ? <View key={entry.id} style={[styles.resultEntry, { backgroundColor: palette.surface }]}><Text style={[styles.itemTitle, { color: palette.text }]}>{String(entry.payload.text ?? entry.payload.caption)}</Text></View> : null)}</>;
  if (activity.type === "song-exchange") return <><Text style={[styles.resultTitle, { color: palette.text }]}>{language === "ru" ? "Ваш музыкальный момент" : "Your musical moment"}</Text>{activity.entries.map((entry) => <Pressable key={entry.id} onPress={() => typeof entry.payload.url === "string" && void Linking.openURL(entry.payload.url)} style={[styles.songResult, { backgroundColor: palette.surface }]}><View style={[styles.songPlay, { backgroundColor: palette.accent }]}><AppIcon name="play" size={18} color="#FFF" /></View><View style={styles.flex}><Text style={[styles.itemTitle, { color: palette.text }]}>{String(entry.payload.title ?? "")}</Text><Text style={[styles.itemMeta, { color: palette.secondaryText }]}>{String(entry.payload.artist ?? (language === "ru" ? "Открыть в музыкальном приложении" : "Open in music app"))}</Text></View><AppIcon name="chevron-forward" size={18} color={palette.accent} /></Pressable>)}</>;
  if (activity.type === "draw-guess") { const drawing = activity.entries.find((entry) => entry.kind === "drawing"); const strokes = Array.isArray(drawing?.payload.strokes) ? drawing.payload.strokes as number[][][] : []; return <><Text style={[styles.resultTitle, { color: palette.text }]}>{language === "ru" ? "Угадано!" : "Guessed!"}</Text><ReadOnlyDrawing strokes={strokes} />{activity.entries.filter((entry) => entry.kind === "guess").map((entry) => <Text key={entry.id} style={[styles.guessLine, { color: entry.payload.correct ? palette.success : palette.secondaryText }]}>{String(entry.payload.guess ?? "")}</Text>)}</>; }
  return <View><Text style={[styles.resultTitle, { color: palette.text }]}>{language === "ru" ? "Это получилось вместе" : "You made this together"}</Text>{activity.entries.map((entry) => <View key={entry.id} style={[styles.resultEntry, { backgroundColor: palette.surface }]}><Text style={[styles.itemTitle, { color: palette.text }]}>{entry.kind === "answer" ? String(entry.payload.answer ?? "") : entry.kind === "guess" ? String(entry.payload.guess ?? "") : String(entry.payload.title ?? entry.payload.text ?? entry.kind)}</Text></View>)}</View>;
}

function MemoryResult({ entries, language }: { entries: CooperativeActivityEntry[]; language: "ru" | "en" }) {
  const palette = usePalette();
  return <><Text style={[styles.resultTitle, { color: palette.text }]}>{language === "ru" ? "Капсула открылась" : "The capsule reopened"}</Text><View style={styles.resultMedia}>{entries.flatMap((entry) => entry.attachments).map((attachment) => <ResultPhoto key={attachment.id} url={attachment.thumbnailUrl ?? attachment.url} />)}</View>{entries.map((entry) => <View key={entry.id} style={[styles.resultEntry, { backgroundColor: palette.surface }]}>{entry.payload.text ? <Text style={[styles.itemTitle, { color: palette.text }]}>{String(entry.payload.text)}</Text> : null}{typeof entry.payload.songUrl === "string" && entry.payload.songUrl ? <Pressable onPress={() => void Linking.openURL(String(entry.payload.songUrl))} style={styles.memorySong}><AppIcon name="music-outline" size={18} color={palette.accent} /><Text numberOfLines={1} style={[styles.flex, styles.itemMeta, { color: palette.accent }]}>{language === "ru" ? "Открыть сохранённую песню" : "Open the saved song"}</Text></Pressable> : null}</View>)}</>;
}

function BlitzResult({ entries, prompts, language }: { entries: CooperativeActivityEntry[]; prompts: unknown; language: "ru" | "en" }) {
  const palette = usePalette(); const list = Array.isArray(prompts) ? prompts as Array<Record<string, unknown>> : []; const first = Array.isArray(entries[0]?.payload.answers) ? entries[0]!.payload.answers : []; const second = Array.isArray(entries[1]?.payload.answers) ? entries[1]!.payload.answers : [];
  const matches = list.filter((_prompt, index) => first[index] === second[index]).length;
  return <><Text style={[styles.resultTitle, { color: palette.text }]}>{language === "ru" ? `${matches} одинаково · ${list.length - matches} по-разному` : `${matches} same · ${list.length - matches} different`}</Text><Text style={[styles.explainer, { color: palette.secondaryText, marginBottom: 10 }]}>{language === "ru" ? "Различия — тоже интересная часть результата." : "Different picks are an interesting part of the result too."}</Text>{list.map((prompt, index) => { const same = first[index] === second[index]; const chosen = first[index] === "left" ? localized(prompt.left, language) : localized(prompt.right, language); return <View key={String(prompt.id ?? index)} style={[styles.blitzResult, { backgroundColor: same ? palette.accentSoft : palette.surface }]}><AppIcon name={same ? "checkmark-done" : "swap-horizontal-outline"} size={18} color={same ? palette.accent : palette.secondaryText} /><Text style={[styles.flex, styles.itemTitle, { color: palette.text }]}>{same ? chosen : `${first[index] === "left" ? localized(prompt.left, language) : localized(prompt.right, language)} · ${second[index] === "left" ? localized(prompt.left, language) : localized(prompt.right, language)}`}</Text></View>; })}</>;
}

function ResultPhoto({ url }: { url: string }) { return <AuthenticatedImage uri={url} cacheKey={url} mimeType="image/webp" style={styles.resultPhoto} />; }
function CollageGrid({ attachments }: { attachments: CooperativeActivityEntry["attachments"] }) {
  const palette = usePalette();
  return <View style={[styles.collageGrid, { backgroundColor: palette.surface }]}>{Array.from({ length: 9 }, (_, index) => { const attachment = attachments[index]; return attachment ? <AuthenticatedImage key={attachment.id} uri={attachment.thumbnailUrl ?? attachment.url} cacheKey={attachment.thumbnailUrl ?? attachment.url} mimeType="image/webp" style={styles.collageCell} /> : <View key={`empty-${index}`} style={[styles.collageCell, styles.collageEmpty, { backgroundColor: palette.border }]}><Text style={{ color: palette.faintText, fontWeight: "800" }}>{index + 1}</Text></View>; })}</View>;
}
function CollagePhoto({ attachment }: { attachment: CooperativeActivityEntry["attachments"][number] }) { return <AuthenticatedImage uri={attachment.url} cacheKey={attachment.id} mimeType={attachment.mimeType} style={styles.collagePhoto} />; }
function ReadOnlyDrawing({ strokes }: { strokes: number[][][] }) { return <View style={styles.canvas}><Svg width="100%" height="100%" viewBox="0 0 300 240">{strokes.map((stroke, index) => <Path key={index} d={stroke.map((point, i) => `${i ? "L" : "M"}${point[0] ?? 0} ${point[1] ?? 0}`).join(" ")} stroke="#19202A" strokeWidth={5} strokeLinecap="round" strokeLinejoin="round" fill="none" />)}</Svg></View>; }
function Waiting({ text }: { text: string }) { const palette = usePalette(); return <View style={[styles.waiting, { backgroundColor: palette.surface }]}><AppIcon name="time-outline" size={25} color={palette.accent} /><Text style={[styles.explainer, { color: palette.secondaryText }]}>{text}</Text></View>; }
function Primary({ label, disabled, busy, onPress }: { label: string; disabled: boolean; busy: boolean; onPress: () => void }) { const palette = usePalette(); return <Pressable accessibilityRole="button" accessibilityState={{ disabled, busy }} disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.primary, { backgroundColor: palette.accent, opacity: disabled ? 0.45 : pressed ? 0.82 : 1 }]}>{busy ? <ActivityIndicator color="#FFF" /> : <Text style={styles.actionText}>{label}</Text>}</Pressable>; }
function Choice({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) { const palette = usePalette(); return <Pressable accessibilityRole="button" accessibilityState={{ selected: active }} onPress={onPress} style={[styles.choice, { backgroundColor: active ? palette.accent : palette.surface, borderColor: active ? palette.accent : palette.border }]}><Text numberOfLines={2} style={{ color: active ? "#FFF" : palette.text, fontWeight: "700", textAlign: "center" }}>{label}</Text></Pressable>; }
function typeLabel(type: string, language: "ru" | "en") { const labels: Record<string, [string, string]> = { question: ["Вопрос для двоих", "Question Drop"], blitz: ["Блиц", "60-Second Blitz"], "tiny-quest": ["Маленький квест", "Tiny Quest"], "color-hunt": ["Охота за цветом", "Color Hunt"], "song-exchange": ["Обмен песнями", "Song Exchange"], "movie-list": ["Наши фильмы", "Movie List"], "draw-guess": ["Нарисуй и угадай", "Draw & Guess"], "ideas-jar": ["Банка идей", "Ideas Jar"], "memory-capsule": ["Капсула памяти", "Memory Capsule"] }; return labels[type]?.[language === "ru" ? 0 : 1] ?? type; }
function promptText(config: Record<string, unknown>, language: "ru" | "en") { return localized(config.prompt ?? config.title, language); }
function localized(value: unknown, language: "ru" | "en") { if (!value || typeof value !== "object" || Array.isArray(value)) return ""; const map = value as Record<string, unknown>; return typeof map[language] === "string" ? map[language] : typeof map.ru === "string" ? map.ru : ""; }

const iconActionStyle = { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" } as const;
const attemptStyle = { minHeight: 28, flexDirection: "row", alignItems: "center", gap: 6 } as const;

const styles = StyleSheet.create({ root: { flex: 1, justifyContent: "flex-end" }, sheet: { maxHeight: "92%", borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingTop: 18 }, header: { flexDirection: "row", alignItems: "flex-start", paddingHorizontal: 18, gap: 12 }, eyebrow: { fontSize: 12, fontWeight: "800", marginBottom: 5 }, title: { fontSize: 22, lineHeight: 27, fontWeight: "800", maxWidth: 300 }, close: { marginLeft: "auto", width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" }, content: { padding: 18, paddingBottom: 10 }, largeInput: { minHeight: 124, borderWidth: 1, borderRadius: 18, padding: 14, fontSize: 16, lineHeight: 22, textAlignVertical: "top" }, input: { height: 50, borderRadius: 15, paddingHorizontal: 14, fontSize: 15, marginTop: 10 }, primary: { height: 50, borderRadius: 16, alignItems: "center", justifyContent: "center", marginTop: 14 }, actionText: { color: "#FFF", fontSize: 15, fontWeight: "800" }, error: { fontSize: 13, lineHeight: 18, marginTop: 10 }, quietActions: { minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 15 }, quietText: { fontSize: 13, fontWeight: "700" }, blitzRow: { flexDirection: "row", alignItems: "center", gap: 7, marginBottom: 8 }, choice: { flex: 1, minHeight: 48, borderWidth: 1, borderRadius: 14, paddingHorizontal: 8, alignItems: "center", justifyContent: "center" }, or: { fontSize: 18 }, explainer: { fontSize: 14, lineHeight: 20 }, addLine: { flexDirection: "row", gap: 8, marginBottom: 12 }, inlineInput: { flex: 1, height: 48, borderRadius: 14, paddingHorizontal: 13, fontSize: 15 }, plus: { width: 48, height: 48, borderRadius: 15, alignItems: "center", justifyContent: "center" }, listItem: { minHeight: 60, borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: 10, justifyContent: "center", flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8 }, flex: { flex: 1 }, itemTitle: { fontSize: 15, lineHeight: 20, fontWeight: "700" }, itemMeta: { fontSize: 12, marginTop: 3 }, ratings: { width: "100%", flexDirection: "row", flexWrap: "wrap", gap: 5, paddingTop: 7 }, rating: { width: 35, height: 35, borderRadius: 11, alignItems: "center", justifyContent: "center" }, picked: { borderRadius: 18, padding: 14, marginBottom: 10 }, pickedTitle: { fontSize: 19, fontWeight: "800", marginTop: 5 }, pickActions: { flexDirection: "row", justifyContent: "space-between", marginTop: 12 }, canvas: { width: "100%", aspectRatio: 1.25, backgroundColor: "#FFFDF8", borderRadius: 18, overflow: "hidden", marginTop: 12 }, liveLabel: { marginTop: 10, textAlign: "center", fontSize: 13, fontWeight: "700" }, collageGrid: { width: "100%", aspectRatio: 1, flexDirection: "row", flexWrap: "wrap", overflow: "hidden", borderRadius: 20, marginTop: 12 }, collageCell: { width: "33.3333%", height: "33.3333%" }, collagePhoto: { width: "100%", aspectRatio: 1, borderRadius: 20, marginTop: 12 }, collageEmpty: { alignItems: "center", justifyContent: "center" }, collageResult: { marginBottom: 18 }, twoActions: { flexDirection: "row", gap: 8, marginTop: 12 }, secondaryButton: { flex: 1, height: 48, borderRadius: 15, flexDirection: "row", gap: 7, alignItems: "center", justifyContent: "center" }, primarySmall: { flex: 1, height: 48, borderRadius: 15, alignItems: "center", justifyContent: "center" }, waiting: { borderRadius: 18, padding: 18, alignItems: "center", gap: 10 }, resultTitle: { fontSize: 24, lineHeight: 29, fontWeight: "800", marginBottom: 12 }, resultEntry: { borderRadius: 16, padding: 13, marginBottom: 7 }, resultMedia: { flexDirection: "row", flexWrap: "wrap", gap: 5, marginBottom: 10 }, resultPhoto: { width: "48%", aspectRatio: 1, borderRadius: 15 }, memorySong: { minHeight: 40, flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8 }, songResult: { minHeight: 64, borderRadius: 17, padding: 10, flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 7 }, songPlay: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" }, guessLine: { fontSize: 15, fontWeight: "700", marginTop: 7 }, blitzResult: { minHeight: 48, borderRadius: 14, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 9, marginBottom: 6 } });
