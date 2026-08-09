import type { CooperativeActivityType } from "@snezhok/contracts";
import { memo, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { usePalette } from "../hooks/usePalette";
import { useTranslation } from "../i18n";
import { AppIcon, type AppIconName } from "./AppIcon";

interface Props {
  visible: boolean;
  busy: boolean;
  onClose: () => void;
  onStart: (type: CooperativeActivityType, options?: Record<string, unknown>) => void;
}

interface LaunchItem { type: CooperativeActivityType; icon: AppIconName; color: string; ink: string; ru: string; en: string; ruHint: string; enHint: string; }

const items: LaunchItem[] = [
  item("question", "help-circle-outline", "#CDB5FF", "#5D3B93", "Вопрос для двоих", "Question Drop", "Ответьте и откройте вместе", "Answer and reveal together"),
  item("blitz", "bolt-outline", "#FF9184", "#782C28", "Блиц", "60-Second Blitz", "Быстрые выборы для обоих", "Quick choices for both"),
  item("tiny-quest", "camera", "#DCEF72", "#405000", "Маленький квест", "Tiny Quest", "Два снимка откроются вместе", "Two photos unlock together"),
  item("color-hunt", "color-palette-outline", "#91E3BB", "#155C3B", "Охота за цветом", "Color Hunt", "По девять находок каждого", "Nine finds from each person"),
  item("song-exchange", "music-outline", "#A8D8FF", "#174C75", "Обмен песнями", "Song Exchange", "Соберите музыкальный дневник", "Build a musical diary"),
  item("movie-list", "movie-outline", "#FFE88A", "#6A5300", "Наши фильмы", "Movie List", "Список, выбор и общие оценки", "List, picks and shared ratings"),
  item("draw-guess", "pencil-outline", "#FFA044", "#6B3100", "Нарисуй и угадай", "Draw & Guess", "Плохие рисунки приветствуются", "Bad drawings welcome"),
  item("ideas-jar", "bulb-outline", "#FFB8C3", "#782C48", "Банка идей", "Ideas Jar", "Выберите, что сделать вместе", "Pick something to do together"),
  item("memory-capsule", "archive-outline", "#FFE88A", "#6A5300", "Капсула памяти", "Memory Capsule", "Заприте и откройте позже", "Lock it and reopen later"),
];

export const ActivityLauncherSheet = memo(function ActivityLauncherSheet({ visible, busy, onClose, onStart }: Props) {
  const palette = usePalette();
  const { language } = useTranslation();
  const insets = useSafeAreaInsets();
  const surprise = useMemo(() => ["question", "blitz", "tiny-quest", "song-exchange", "draw-guess", "ideas-jar"] as CooperativeActivityType[], []);
  const [questionSetup, setQuestionSetup] = useState(false);
  const [capsuleSetup, setCapsuleSetup] = useState(false);
  const [category, setCategory] = useState("random");
  const [secret, setSecret] = useState(true);
  useEffect(() => { if (visible) { setQuestionSetup(false); setCapsuleSetup(false); setCategory("random"); setSecret(true); } }, [visible]);
  return (
    <Modal transparent visible={visible} statusBarTranslucent animationType="fade" onRequestClose={onClose}>
      <View style={styles.root}>
        <Pressable accessibilityRole="button" accessibilityLabel={language === "ru" ? "Закрыть" : "Close"} style={[StyleSheet.absoluteFill, { backgroundColor: palette.overlay }]} onPress={onClose} />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom + 8, 20), backgroundColor: palette.elevated }]}>
          <View style={[styles.handle, { backgroundColor: palette.border }]} />
          <View style={styles.heading}>
            <View><Text style={[styles.title, { color: palette.text }]}>{language === "ru" ? "Что сделаем вместе?" : "What should we do together?"}</Text><Text style={[styles.subtitle, { color: palette.secondaryText }]}>{language === "ru" ? "Одно действие — и оно появится в чате у вас обоих." : "One tap and it appears in both chat histories."}</Text></View>
            {busy ? <ActivityIndicator color={palette.accent} /> : null}
          </View>
          {questionSetup ? <View style={styles.setup}>
            <Text style={[styles.setupTitle, { color: palette.text }]}>{language === "ru" ? "Какой вопрос?" : "Which kind of question?"}</Text>
            <View style={styles.categoryGrid}>{questionCategories.map((option) => <Pressable accessibilityRole="button" accessibilityState={{ selected: category === option.id }} key={option.id} onPress={() => setCategory(option.id)} style={[styles.category, { backgroundColor: category === option.id ? "#CDB5FF" : palette.surface, borderColor: category === option.id ? "#5D3B93" : palette.border }]}><Text style={{ color: category === option.id ? "#5D3B93" : palette.text, fontWeight: "700", fontSize: 12 }}>{language === "ru" ? option.ru : option.en}</Text></Pressable>)}</View>
            {category === "romantic" || category === "nsfw" ? <Text style={[styles.consentHint, { color: palette.secondaryText }]}>{language === "ru" ? "Эта категория доступна, только если оба человека включили её в Настройках." : "This category works only when both people enable it in Settings."}</Text> : null}
            <Pressable accessibilityRole="switch" accessibilityState={{ checked: secret }} onPress={() => setSecret((value) => !value)} style={[styles.secretToggle, { backgroundColor: palette.surface }]}><AppIcon name={secret ? "lock-closed-outline" : "eye-outline"} size={20} color={palette.accent} /><Text style={[styles.flex, { color: palette.text, fontWeight: "700" }]}>{secret ? (language === "ru" ? "Ответы откроются вместе" : "Answers reveal together") : (language === "ru" ? "Ответы видны сразу" : "Answers appear immediately")}</Text><View style={[styles.toggle, { backgroundColor: secret ? palette.accent : palette.border }]}><View style={[styles.toggleKnob, { transform: [{ translateX: secret ? 18 : 0 }] }]} /></View></Pressable>
            <Pressable disabled={busy} onPress={() => onStart("question", { category, secret })} style={[styles.startQuestion, { backgroundColor: palette.accent }]}>{busy ? <ActivityIndicator color={palette.onAccent} /> : <Text style={[styles.surpriseTitle, { color: palette.onAccent }]}>{language === "ru" ? "Задать вопрос" : "Drop the question"}</Text>}</Pressable>
            <Pressable disabled={busy} onPress={() => setQuestionSetup(false)} style={styles.backSetup}><Text style={{ color: palette.secondaryText, fontWeight: "700" }}>{language === "ru" ? "Назад" : "Back"}</Text></Pressable>
          </View> : capsuleSetup ? <View style={styles.setup}>
            <Text style={[styles.setupTitle, { color: palette.text }]}>{language === "ru" ? "Когда открыть капсулу?" : "When should it reopen?"}</Text>
            <Text style={[styles.consentHint, { color: palette.secondaryText }]}>{language === "ru" ? "После вклада обоих содержимое будет скрыто до выбранной даты." : "After both contributions, everything stays hidden until the chosen date."}</Text>
            <View style={styles.capsuleChoices}>
              <Pressable accessibilityRole="button" disabled={busy} onPress={() => onStart("memory-capsule", { months: 1 })} style={[styles.capsuleChoice, { backgroundColor: "#FFE88A" }]}><Text style={styles.capsuleNumber}>1</Text><Text style={styles.capsuleLabel}>{language === "ru" ? "месяц" : "month"}</Text></Pressable>
              <Pressable accessibilityRole="button" disabled={busy} onPress={() => onStart("memory-capsule", { months: 6 })} style={[styles.capsuleChoice, { backgroundColor: "#CDB5FF" }]}><Text style={styles.capsuleNumber}>6</Text><Text style={styles.capsuleLabel}>{language === "ru" ? "месяцев" : "months"}</Text></Pressable>
            </View>
            <Pressable disabled={busy} onPress={() => setCapsuleSetup(false)} style={styles.backSetup}><Text style={{ color: palette.secondaryText, fontWeight: "700" }}>{language === "ru" ? "Назад" : "Back"}</Text></Pressable>
          </View> : <><Pressable accessibilityRole="button" disabled={busy} onPress={() => onStart(surprise[Math.floor(Math.random() * surprise.length)]!)} style={({ pressed }) => [styles.surprise, { backgroundColor: palette.accent, opacity: busy ? 0.45 : pressed ? 0.82 : 1 }]}>
            <AppIcon name="sparkles-outline" size={22} color={palette.onAccent} />
            <View style={styles.flex}><Text style={[styles.surpriseTitle, { color: palette.onAccent }]}>{language === "ru" ? "Удиви нас" : "Surprise us"}</Text><Text style={[styles.surpriseHint, { color: palette.onAccent }]}>{language === "ru" ? "Snezhok сам выберет момент" : "Let Snezhok choose the moment"}</Text></View>
          </Pressable>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.grid}>
            {items.map((entry) => <Pressable accessibilityRole="button" key={entry.type} disabled={busy} onPress={() => entry.type === "question" ? setQuestionSetup(true) : entry.type === "memory-capsule" ? setCapsuleSetup(true) : onStart(entry.type)} style={({ pressed }) => [styles.card, { backgroundColor: entry.color, opacity: busy ? 0.5 : pressed ? 0.78 : 1 }]}>
              <View style={[styles.icon, { backgroundColor: "rgba(255,255,255,0.5)" }]}><AppIcon name={entry.icon} size={23} color={entry.ink} /></View>
              <Text style={[styles.cardTitle, { color: entry.ink }]}>{language === "ru" ? entry.ru : entry.en}</Text>
              <Text style={[styles.cardHint, { color: entry.ink }]}>{language === "ru" ? entry.ruHint : entry.enHint}</Text>
            </Pressable>)}
          </ScrollView></>}
        </View>
      </View>
    </Modal>
  );
});

function item(type: CooperativeActivityType, icon: AppIconName, color: string, ink: string, ru: string, en: string, ruHint: string, enHint: string): LaunchItem {
  return { type, icon, color, ink, ru, en, ruHint, enHint };
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: "flex-end" },
  sheet: { maxHeight: "88%", borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 16, paddingTop: 10 },
  handle: { width: 38, height: 4, borderRadius: 999, alignSelf: "center", marginBottom: 16 },
  heading: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 14 },
  title: { fontSize: 24, lineHeight: 29, fontWeight: "800" },
  subtitle: { fontSize: 14, lineHeight: 19, marginTop: 4, maxWidth: 310 },
  surprise: { minHeight: 64, borderRadius: 20, paddingHorizontal: 16, flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 12 },
  surpriseTitle: { fontSize: 17, fontWeight: "800" }, surpriseHint: { fontSize: 12, marginTop: 2, opacity: 0.78 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10, paddingBottom: 8 },
  card: { width: "48%", minHeight: 132, borderRadius: 22, padding: 14 },
  icon: { width: 39, height: 39, borderRadius: 14, alignItems: "center", justifyContent: "center", marginBottom: 12 },
  cardTitle: { fontSize: 16, lineHeight: 20, fontWeight: "800" }, cardHint: { fontSize: 12, lineHeight: 16, marginTop: 4, opacity: 0.82 },
  flex: { flex: 1 },
  setup: { paddingBottom: 6 }, setupTitle: { fontSize: 18, fontWeight: "800", marginBottom: 12 }, categoryGrid: { flexDirection: "row", flexWrap: "wrap", gap: 7 }, category: { minHeight: 38, borderRadius: 13, borderWidth: 1, paddingHorizontal: 11, alignItems: "center", justifyContent: "center" }, secretToggle: { minHeight: 58, borderRadius: 16, flexDirection: "row", alignItems: "center", paddingHorizontal: 13, gap: 10, marginTop: 13 }, toggle: { width: 40, height: 22, borderRadius: 11, padding: 2 }, toggleKnob: { width: 18, height: 18, borderRadius: 9, backgroundColor: "#FFF" }, startQuestion: { height: 50, borderRadius: 16, alignItems: "center", justifyContent: "center", marginTop: 13 }, backSetup: { height: 42, alignItems: "center", justifyContent: "center" },
  capsuleChoices: { flexDirection: "row", gap: 10, marginTop: 16 }, capsuleChoice: { flex: 1, minHeight: 128, borderRadius: 22, alignItems: "center", justifyContent: "center" }, capsuleNumber: { color: "#4E3B00", fontSize: 42, lineHeight: 46, fontWeight: "900" }, capsuleLabel: { color: "#4E3B00", fontSize: 15, fontWeight: "800", marginTop: 3 },
  consentHint: { fontSize: 12, lineHeight: 17, marginTop: 9 },
});

const questionCategories = [
  { id: "random", ru: "Случайно", en: "Random" }, { id: "silly", ru: "Смешное", en: "Silly" },
  { id: "childhood", ru: "Детство", en: "Childhood" }, { id: "preferences", ru: "Предпочтения", en: "Preferences" },
  { id: "hypothetical", ru: "А если…", en: "Hypothetical" }, { id: "deep", ru: "Глубокое", en: "Deep" },
  { id: "romantic", ru: "Романтика", en: "Romantic" }, { id: "nsfw", ru: "18+", en: "NSFW" },
] as const;
