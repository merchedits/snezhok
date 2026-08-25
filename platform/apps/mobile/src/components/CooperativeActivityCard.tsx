import type { CooperativeActivity, CooperativeActivityType } from "@snezhok/contracts";
import { memo } from "react";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { usePalette } from "../hooks/usePalette";
import { useTranslation } from "../i18n";
import { useAppStore } from "../store/useAppStore";
import { AppIcon, type AppIconName } from "./AppIcon";
import { AuthenticatedImage } from "./AuthenticatedImage";
import { Avatar } from "./Avatar";
import { distinctActivityCopy, isPersistentCollection, persistentCollectionStatus } from "./activities/activityPresentation";

const meta: Record<CooperativeActivityType, { fill: string; ink: string; icon: AppIconName; ru: string; en: string }> = {
  question: {
    fill: "#CDB5FF",
    ink: "#5D3B93",
    icon: "help-circle-outline",
    ru: "Вопрос для двоих",
    en: "Question Drop",
  },
  blitz: {
    fill: "#FF9184",
    ink: "#782C28",
    icon: "bolt-outline",
    ru: "Блиц",
    en: "60-Second Blitz",
  },
  "tiny-quest": {
    fill: "#DCEF72",
    ink: "#405000",
    icon: "camera",
    ru: "Маленький квест",
    en: "Tiny Quest",
  },
  "color-hunt": {
    fill: "#91E3BB",
    ink: "#155C3B",
    icon: "color-palette-outline",
    ru: "Охота за цветом",
    en: "Color Hunt",
  },
  "song-exchange": {
    fill: "#A8D8FF",
    ink: "#174C75",
    icon: "music-outline",
    ru: "Обмен песнями",
    en: "Song Exchange",
  },
  "movie-list": {
    fill: "#FFE88A",
    ink: "#6A5300",
    icon: "movie-outline",
    ru: "Наши фильмы",
    en: "Movie List",
  },
  "draw-guess": {
    fill: "#FFA044",
    ink: "#6B3100",
    icon: "pencil-outline",
    ru: "Нарисуй и угадай",
    en: "Draw & Guess",
  },
  "ideas-jar": {
    fill: "#FFB8C3",
    ink: "#782C48",
    icon: "bulb-outline",
    ru: "Банка идей",
    en: "Ideas Jar",
  },
  "memory-capsule": {
    fill: "#FFE88A",
    ink: "#6A5300",
    icon: "archive-outline",
    ru: "Капсула памяти",
    en: "Memory Capsule",
  },
  milestone: {
    fill: "#91E3BB",
    ink: "#155C3B",
    icon: "sparkles-outline",
    ru: "Общее достижение",
    en: "Shared milestone",
  },
};

export const CooperativeActivityCard = memo(function CooperativeActivityCard({ activity, onOpen }: { activity: CooperativeActivity; onOpen: () => void }) {
  const { language } = useTranslation();
  const palette = usePalette();
  const meId = useAppStore((state) => state.me?.id);
  const style = meta[activity.type];
  const ownEntry = activity.entries.find((entry) => entry.createdBy === meId);
  const ownParticipant = activity.participants.find((participant) => participant.user.id === meId);
  const prompt = distinctActivityCopy(
    language === "ru" ? style.ru : style.en,
    localized(activity.config.prompt, language),
    localized(activity.config.title, language),
  );
  const milestone = activity.type === "milestone";
  const actionable = !milestone && !["declined", "expired", "cancelled"].includes(activity.state);
  const button = actionLabel(activity, Boolean(ownEntry) || Boolean(ownParticipant && (ownParticipant.contributionCount > 0 || ["submitted", "completed"].includes(ownParticipant.status))), language);
  return (
    <View style={[milestone ? styles.milestoneCard : styles.card, { backgroundColor: style.fill }]}>
      <View style={styles.topline}>
        <View style={[styles.icon, { backgroundColor: "rgba(255,255,255,0.48)" }]}>
          <AppIcon name={style.icon} size={20} color={style.ink} />
        </View>
        <Text style={[styles.label, { color: style.ink }]}>{language === "ru" ? style.ru : style.en}</Text>
        {activity.config.secret === true && activity.state !== "completed" ? (
          <View style={styles.secret}>
            <AppIcon name="lock-closed-outline" size={13} color={style.ink} />
            <Text style={[styles.secretText, { color: style.ink }]}>{language === "ru" ? "тайно" : "secret"}</Text>
          </View>
        ) : null}
      </View>
      {prompt ? <Text style={[styles.prompt, { color: style.ink }]}>{prompt}</Text> : null}
      {!milestone ? <ActivityPreview activity={activity} ink={style.ink} language={language} /> : null}
      {!milestone ? (
        <View style={styles.people}>
          {activity.participants.map((participant) => (
            <View key={participant.user.id} style={styles.person}>
              <Avatar uri={participant.user.avatarUrl} label={participant.user.displayName} color={participant.user.avatarColor} size={27} />
              <View
                style={[
                  styles.dot,
                  {
                    backgroundColor: ["submitted", "completed"].includes(participant.status) ? palette.success : "rgba(255,255,255,0.76)",
                    borderColor: style.fill,
                  },
                ]}
              />
            </View>
          ))}
          <Text style={[styles.state, { color: style.ink }]}>{stateLabel(activity, language)}</Text>
        </View>
      ) : (
        <Text style={[styles.milestoneCaption, { color: style.ink }]}>{language === "ru" ? "Добавлено в вашу общую историю" : "Added to your shared history"}</Text>
      )}
      {actionable ? (
        <Pressable accessibilityRole="button" accessibilityLabel={button} onPress={onOpen} style={({ pressed }) => [styles.action, { backgroundColor: style.ink, opacity: pressed ? 0.82 : 1 }]}>
          <Text style={styles.actionText}>{button}</Text>
          <AppIcon name="chevron-forward" size={18} color="#FFFFFF" />
        </Pressable>
      ) : null}
    </View>
  );
});

function ActivityPreview({ activity, ink, language }: { activity: CooperativeActivity; ink: string; language: "ru" | "en" }) {
  if (activity.type === "color-hunt") {
    const color = activity.privateState.color as { hex?: string; name?: unknown } | undefined;
    const photos = activity.entries
      .filter((entry) => entry.kind === "photo")
      .flatMap((entry) => entry.attachments)
      .slice(0, 9);
    if (activity.state === "completed")
      return (
        <View style={styles.collageRow}>
          {activity.participants.map((participant) => {
            const collage = activity.entries.find((entry) => entry.createdBy === participant.user.id && entry.kind === "collage")?.attachments[0];
            const participantPhotos = activity.entries
              .filter((entry) => entry.createdBy === participant.user.id && entry.kind === "photo")
              .flatMap((entry) => entry.attachments)
              .slice(0, 9);
            return (
              <View key={participant.user.id}>
                <Text numberOfLines={1} style={[styles.collageName, { color: ink }]}>
                  {participant.user.displayName}
                </Text>
                {collage ? (
                  <AuthenticatedImage uri={collage.thumbnailUrl ?? collage.url} cacheKey={collage.id} mimeType={collage.mimeType} style={styles.collagePhoto} />
                ) : (
                  <View style={styles.miniCollage}>
                    {participantPhotos.map((attachment) => (
                      <MiniPhoto key={attachment.id} url={attachment.thumbnailUrl ?? attachment.url} />
                    ))}
                  </View>
                )}
              </View>
            );
          })}
        </View>
      );
    return (
      <View>
        <View style={styles.colorLine}>
          {color?.hex ? <View style={[styles.colorDot, { backgroundColor: color.hex }]} /> : null}
          <Text style={[styles.previewText, { color: ink }]}>
            {localized(color?.name, language)} · {photos.length}/9
          </Text>
        </View>
        {photos.length ? (
          <View style={styles.photoGrid}>
            {photos.map((attachment) => (
              <Photo key={attachment.id} url={attachment.thumbnailUrl ?? attachment.url} />
            ))}
          </View>
        ) : null}
      </View>
    );
  }
  if (activity.type === "movie-list" || activity.type === "ideas-jar") {
    const label = activity.type === "movie-list" ? (language === "ru" ? "В списке" : "On the list") : language === "ru" ? "Идей" : "Ideas";
    const count = typeof activity.result?.entryCount === "number" ? activity.result.entryCount : activity.entries.length;
    return (
      <Text style={[styles.count, { color: ink }]}>
        {count} · {label.toLocaleLowerCase()}
      </Text>
    );
  }
  if (activity.type === "song-exchange" && activity.state === "completed")
    return (
      <View style={styles.pairs}>
        {activity.entries.slice(0, 2).map((entry) => (
          <Pressable key={entry.id} onPress={() => typeof entry.payload.url === "string" && void Linking.openURL(entry.payload.url)} style={styles.pair}>
            <AppIcon name="play" size={15} color={ink} />
            <Text numberOfLines={1} style={[styles.pairText, { color: ink }]}>
              {String(entry.payload.title ?? "Song")}
            </Text>
          </Pressable>
        ))}
      </View>
    );
  if (activity.type === "tiny-quest" && activity.state === "completed")
    return (
      <View style={styles.photoRow}>
        {activity.entries
          .flatMap((entry) => entry.attachments)
          .slice(0, 2)
          .map((attachment) => (
            <Photo key={attachment.id} url={attachment.thumbnailUrl ?? attachment.url} wide />
          ))}
      </View>
    );
  if (activity.state === "completed" && activity.type === "question")
    return (
      <View style={styles.answers}>
        {activity.entries.map((entry) => (
          <Text key={entry.id} style={[styles.answer, { color: ink }]}>
            {String(entry.payload.answer ?? "")}
          </Text>
        ))}
      </View>
    );
  if (activity.state === "locked")
    return (
      <View style={styles.locked}>
        <AppIcon name="lock-closed-outline" size={24} color={ink} />
        <Text style={[styles.previewText, { color: ink }]}>{language === "ru" ? "Откроется в назначенный день" : "Opens on its reveal day"}</Text>
      </View>
    );
  return null;
}

function Photo({ url, wide = false }: { url: string; wide?: boolean }) {
  return <AuthenticatedImage uri={url} cacheKey={url} mimeType="image/webp" style={wide ? styles.widePhoto : styles.photo} />;
}

function MiniPhoto({ url }: { url: string }) {
  return <AuthenticatedImage uri={url} cacheKey={url} mimeType="image/webp" style={styles.miniPhoto} />;
}

function actionLabel(activity: CooperativeActivity, ownEntry: boolean, language: "ru" | "en") {
  if (activity.state === "completed") return language === "ru" ? "Посмотреть результат" : "See result";
  if (activity.state === "locked") return language === "ru" ? "Посмотреть капсулу" : "View capsule";
  if (activity.type === "movie-list" || activity.type === "ideas-jar" || activity.type === "color-hunt") return language === "ru" ? "Открыть" : "Open";
  if (ownEntry) return language === "ru" ? "Мой ответ" : "My answer";
  return language === "ru" ? "Участвовать" : "Join in";
}

function stateLabel(activity: CooperativeActivity, language: "ru" | "en") {
  if (isPersistentCollection(activity.type)) return persistentCollectionStatus(language);
  if (activity.state === "completed") return language === "ru" ? "Готово вместе" : "Completed together";
  if (activity.state === "locked") return activity.revealAt ? new Date(activity.revealAt).toLocaleDateString(language === "ru" ? "ru-RU" : "en-US") : language === "ru" ? "Заперто" : "Locked";
  if (activity.state === "declined") return language === "ru" ? "Отклонено" : "Declined";
  if (activity.state === "cancelled") return language === "ru" ? "Отменено" : "Cancelled";
  if (activity.state === "expired") return language === "ru" ? "Истекло" : "Expired";
  const waiting = activity.participants.find((participant) => !["submitted", "completed"].includes(participant.status));
  return waiting ? (language === "ru" ? `Ждём ${waiting.user.displayName}` : `Waiting for ${waiting.user.displayName}`) : language === "ru" ? "Можно продолжить" : "Ready to continue";
}

function localized(value: unknown, language: "ru" | "en") {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const map = value as Record<string, unknown>;
  return typeof map[language] === "string" ? map[language] : typeof map.ru === "string" ? map.ru : "";
}

const styles = StyleSheet.create({
  card: { width: 302, borderRadius: 24, padding: 15, overflow: "hidden" },
  milestoneCard: {
    width: 274,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 12,
    overflow: "hidden",
  },
  milestoneCaption: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: "700",
    marginTop: 7,
    opacity: 0.78,
  },
  topline: {
    minHeight: 34,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  icon: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  label: { flex: 1, fontSize: 13, fontWeight: "800" },
  secret: { flexDirection: "row", alignItems: "center", gap: 3 },
  secretText: { fontSize: 11, fontWeight: "700" },
  prompt: {
    fontSize: 20,
    lineHeight: 25,
    fontWeight: "800",
    marginTop: 14,
    marginBottom: 12,
  },
  count: { fontSize: 28, fontWeight: "800", marginVertical: 12 },
  people: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 35,
    marginTop: 10,
  },
  person: { marginRight: -5 },
  dot: {
    position: "absolute",
    right: -1,
    bottom: -1,
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 2,
  },
  state: {
    flex: 1,
    marginLeft: 14,
    fontSize: 12,
    fontWeight: "700",
    textAlign: "right",
  },
  action: {
    marginTop: 12,
    height: 46,
    borderRadius: 15,
    paddingHorizontal: 15,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  actionText: { color: "#FFFFFF", fontSize: 14, fontWeight: "800" },
  colorLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    marginTop: 10,
  },
  colorDot: { width: 17, height: 17, borderRadius: 9 },
  previewText: { fontSize: 13, lineHeight: 18, fontWeight: "700" },
  photoGrid: { flexDirection: "row", flexWrap: "wrap", gap: 3, marginTop: 10 },
  photo: { width: 82, height: 82, borderRadius: 9 },
  photoRow: { flexDirection: "row", gap: 5, marginTop: 8 },
  widePhoto: { width: 133, height: 100, borderRadius: 12 },
  pairs: { gap: 6, marginTop: 10 },
  pair: {
    height: 38,
    borderRadius: 12,
    paddingHorizontal: 10,
    backgroundColor: "rgba(255,255,255,0.42)",
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  pairText: { flex: 1, fontSize: 13, fontWeight: "700" },
  answers: { gap: 6, marginTop: 8 },
  answer: {
    backgroundColor: "rgba(255,255,255,0.42)",
    borderRadius: 13,
    padding: 10,
    fontSize: 14,
    lineHeight: 19,
  },
  locked: {
    minHeight: 80,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  collageRow: { flexDirection: "row", gap: 7, marginTop: 10 },
  collageName: { width: 131, fontSize: 11, fontWeight: "700", marginBottom: 4 },
  collagePhoto: { width: 131, height: 131, borderRadius: 12 },
  miniCollage: { width: 131, flexDirection: "row", flexWrap: "wrap", gap: 2 },
  miniPhoto: { width: 42, height: 42, borderRadius: 5 },
});
