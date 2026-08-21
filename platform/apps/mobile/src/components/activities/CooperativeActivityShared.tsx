import type { CooperativeActivityEntry, CooperativeActivityParticipant, Message } from "@snezhok/contracts";
import { useState } from "react";
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import Svg, { Path } from "react-native-svg";

import { useAuthorizedMedia } from "../../hooks/useAuthorizedMedia";
import { usePalette } from "../../hooks/usePalette";
import { useTranslation } from "../../i18n";
import { AppIcon } from "../AppIcon";
import { AuthenticatedImage } from "../AuthenticatedImage";
import { Avatar } from "../Avatar";
import { ImageViewer } from "../ImageViewer";
import { cooperativeActivityStyles as styles } from "./cooperativeActivityStyles";

const COLLAGE_ROWS = [[0, 1, 2], [3, 4, 5], [6, 7, 8]] as const;

export function TerminalActivity({ state, language }: { state: string; language: "ru" | "en" }) {
  const palette = usePalette();
  const copy = state === "declined" ? (language === "ru" ? "Участие отклонено. Сохранённые материалы больше не раскрываются." : "Participation was declined. Saved contributions will not be revealed.") : state === "expired" ? (language === "ru" ? "Это действие завершилось по времени." : "This activity has expired.") : language === "ru" ? "Создатель отменил это действие для обоих." : "The creator cancelled this activity for both people.";
  return (
    <View accessibilityRole="summary" style={[styles.waiting, { backgroundColor: palette.surface }]}>
      <AppIcon name="warning-outline" size={28} color={palette.secondaryText} />
      <Text style={[styles.explainer, { color: palette.secondaryText, textAlign: "center" }]}>{copy}</Text>
    </View>
  );
}

export function ResultView({ message }: { message: Message }) {
  const activity = message.activity!;
  const palette = usePalette();
  const { language } = useTranslation();
  if (activity.state === "locked")
    return (
      <View style={styles.waiting}>
        <AppIcon name="lock-closed-outline" size={34} color={palette.accent} />
        <Text style={[styles.resultTitle, { color: palette.text, textAlign: "center" }]}>{language === "ru" ? "Капсула надёжно закрыта" : "The capsule is safely locked"}</Text>
        <Text style={[styles.explainer, { color: palette.secondaryText, textAlign: "center" }]}>{activity.revealAt ? new Date(activity.revealAt).toLocaleString(language === "ru" ? "ru-RU" : "en-US") : ""}</Text>
      </View>
    );
  if (activity.type === "blitz") return <BlitzResult entries={activity.entries} participants={activity.participants} prompts={activity.config.prompts} language={language} />;
  if (activity.type === "memory-capsule") return <MemoryResult entries={activity.entries} language={language} />;
  if (activity.type === "color-hunt")
    return (
      <>
        <Text style={[styles.resultTitle, { color: palette.text }]}>{language === "ru" ? "Два цветных коллажа" : "Two colour collages"}</Text>
        {activity.participants.map((participant) => {
          const collage = activity.entries.find((entry) => entry.createdBy === participant.user.id && entry.kind === "collage")?.attachments[0];
          const photos = activity.entries.filter((entry) => entry.createdBy === participant.user.id && entry.kind === "photo").flatMap((entry) => entry.attachments);
          return (
            <View key={participant.user.id} style={styles.collageResult}>
              <Text style={[styles.itemTitle, { color: palette.text }]}>{participant.user.displayName}</Text>
              {collage ? <CollagePhoto attachment={collage} /> : <CollageGrid attachments={photos} />}
            </View>
          );
        })}
      </>
    );
  if (activity.type === "tiny-quest")
    return (
      <>
        <Text style={[styles.resultTitle, { color: palette.text }]}>{language === "ru" ? "Открыто вместе" : "Revealed together"}</Text>
        <View style={styles.resultMedia}>
          {activity.entries
            .flatMap((entry) => entry.attachments)
            .map((attachment) => (
              <ResultPhoto key={attachment.id} attachment={attachment} />
            ))}
        </View>
        {activity.entries.map((entry) =>
          entry.payload.text || entry.payload.caption ? (
            <View key={entry.id} style={[styles.resultEntry, { backgroundColor: palette.surface }]}>
              <Text style={[styles.itemTitle, { color: palette.text }]}>{String(entry.payload.text ?? entry.payload.caption)}</Text>
            </View>
          ) : null,
        )}
      </>
    );
  if (activity.type === "song-exchange")
    return (
      <>
        <Text style={[styles.resultTitle, { color: palette.text }]}>{language === "ru" ? "Ваш музыкальный момент" : "Your musical moment"}</Text>
        {activity.entries.map((entry) => (
          <Pressable key={entry.id} onPress={() => typeof entry.payload.url === "string" && void Linking.openURL(entry.payload.url)} style={[styles.songResult, { backgroundColor: palette.surface }]}>
            <View style={[styles.songPlay, { backgroundColor: palette.accent }]}>
              <AppIcon name="play" size={18} color="#FFF" />
            </View>
            <View style={styles.flex}>
              <Text style={[styles.itemTitle, { color: palette.text }]}>{String(entry.payload.title ?? "")}</Text>
              <Text style={[styles.itemMeta, { color: palette.secondaryText }]}>{String(entry.payload.artist ?? (language === "ru" ? "Открыть в музыкальном приложении" : "Open in music app"))}</Text>
            </View>
            <AppIcon name="chevron-forward" size={18} color={palette.accent} />
          </Pressable>
        ))}
      </>
    );
  if (activity.type === "draw-guess") {
    const drawing = activity.entries.find((entry) => entry.kind === "drawing");
    const strokes = Array.isArray(drawing?.payload.strokes) ? (drawing.payload.strokes as number[][][]) : [];
    return (
      <>
        <Text style={[styles.resultTitle, { color: palette.text }]}>{language === "ru" ? "Угадано!" : "Guessed!"}</Text>
        <ReadOnlyDrawing strokes={strokes} />
        {activity.entries
          .filter((entry) => entry.kind === "guess")
          .map((entry) => (
            <Text
              key={entry.id}
              style={[
                styles.guessLine,
                {
                  color: entry.payload.correct ? palette.success : palette.secondaryText,
                },
              ]}
            >
              {String(entry.payload.guess ?? "")}
            </Text>
          ))}
      </>
    );
  }
  return (
    <View>
      <Text style={[styles.resultTitle, { color: palette.text }]}>{language === "ru" ? "Это получилось вместе" : "You made this together"}</Text>
      {activity.entries.map((entry) => (
        <View key={entry.id} style={[styles.resultEntry, { backgroundColor: palette.surface }]}>
          <Text style={[styles.itemTitle, { color: palette.text }]}>{entry.kind === "answer" ? String(entry.payload.answer ?? "") : entry.kind === "guess" ? String(entry.payload.guess ?? "") : String(entry.payload.title ?? entry.payload.text ?? entry.kind)}</Text>
        </View>
      ))}
    </View>
  );
}

function MemoryResult({ entries, language }: { entries: CooperativeActivityEntry[]; language: "ru" | "en" }) {
  const palette = usePalette();
  return (
    <>
      <Text style={[styles.resultTitle, { color: palette.text }]}>{language === "ru" ? "Капсула открылась" : "The capsule reopened"}</Text>
      <View style={styles.resultMedia}>
        {entries
          .flatMap((entry) => entry.attachments)
          .map((attachment) => (
            <ResultPhoto key={attachment.id} attachment={attachment} />
          ))}
      </View>
      {entries.map((entry) => (
        <View key={entry.id} style={[styles.resultEntry, { backgroundColor: palette.surface }]}>
          {entry.payload.text ? <Text style={[styles.itemTitle, { color: palette.text }]}>{String(entry.payload.text)}</Text> : null}
          {typeof entry.payload.songUrl === "string" && entry.payload.songUrl ? (
            <Pressable onPress={() => void Linking.openURL(String(entry.payload.songUrl))} style={styles.memorySong}>
              <AppIcon name="music-outline" size={18} color={palette.accent} />
              <Text numberOfLines={1} style={[styles.flex, styles.itemMeta, { color: palette.accent }]}>
                {language === "ru" ? "Открыть сохранённую песню" : "Open the saved song"}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ))}
    </>
  );
}

function BlitzResult({ entries, participants, prompts, language }: { entries: CooperativeActivityEntry[]; participants: CooperativeActivityParticipant[]; prompts: unknown; language: "ru" | "en" }) {
  const palette = usePalette();
  const list = Array.isArray(prompts) ? (prompts as Array<Record<string, unknown>>) : [];
  const first = Array.isArray(entries[0]?.payload.answers) ? entries[0]!.payload.answers : [];
  const second = Array.isArray(entries[1]?.payload.answers) ? entries[1]!.payload.answers : [];
  const matches = list.filter((_prompt, index) => first[index] === second[index]).length;
  const firstUser = participants.find((participant) => participant.user.id === entries[0]?.createdBy)?.user;
  const secondUser = participants.find((participant) => participant.user.id === entries[1]?.createdBy)?.user;
  return (
    <>
      <Text style={[styles.resultTitle, { color: palette.text }]}>{language === "ru" ? `${matches} одинаково · ${list.length - matches} по-разному` : `${matches} same · ${list.length - matches} different`}</Text>
      <Text style={[styles.explainer, { color: palette.secondaryText, marginBottom: 10 }]}>{language === "ru" ? "Различия — тоже интересная часть результата." : "Different picks are an interesting part of the result too."}</Text>
      {list.map((prompt, index) => {
        const same = first[index] === second[index];
        const firstChoice = first[index] === "left" ? localized(prompt.left, language) : localized(prompt.right, language);
        const secondChoice = second[index] === "left" ? localized(prompt.left, language) : localized(prompt.right, language);
        return (
          <View key={String(prompt.id ?? index)} style={[styles.blitzResult, { backgroundColor: same ? palette.accentSoft : palette.surface }]}>
            <AvatarStack users={same ? [firstUser, secondUser] : [firstUser]} />
            <Text style={[styles.flex, styles.itemTitle, { color: palette.text }]}>{same ? firstChoice : `${firstChoice} · ${secondChoice}`}</Text>
            {!same ? <AvatarStack users={[secondUser]} /> : null}
          </View>
        );
      })}
    </>
  );
}

function AvatarStack({ users }: { users: Array<CooperativeActivityParticipant["user"] | undefined> }) {
  return (
    <View style={styles.avatarStack}>
      {users.filter(Boolean).map((user, index) => (
        <View key={user!.id} style={{ marginLeft: index ? -9 : 0, zIndex: users.length - index }}>
          <Avatar uri={user!.avatarUrl} label={user!.displayName} color={user!.avatarColor} size={27} />
        </View>
      ))}
    </View>
  );
}

function ResultPhoto({ url, attachment }: { url?: string; attachment?: CooperativeActivityEntry["attachments"][number] }) {
  const item = attachment ?? {
    id: url ?? "photo",
    url: url ?? "",
    thumbnailUrl: url ?? null,
    filename: "snezhok-photo.jpg",
    mimeType: "image/jpeg",
  };
  const [open, setOpen] = useState(false);
  const source = useAuthorizedMedia(item.url);
  return (
    <>
      <Pressable accessibilityRole="imagebutton" onPress={() => setOpen(true)} style={styles.resultPhoto}>
        <AuthenticatedImage uri={item.thumbnailUrl ?? item.url} cacheKey={item.id} mimeType={item.mimeType} style={StyleSheet.absoluteFill} />
      </Pressable>
      <ImageViewer visible={open} source={source} filename={item.filename} mimeType={item.mimeType} onClose={() => setOpen(false)} />
    </>
  );
}
export function CollageGrid({ attachments }: { attachments: CooperativeActivityEntry["attachments"] }) {
  const palette = usePalette();
  return (
    <View style={[styles.collageGrid, { backgroundColor: palette.surface }]}>
      {COLLAGE_ROWS.map((indices, row) => (
        <View key={`row-${row}`} style={styles.collageRow}>
          {indices.map((index) => {
            const attachment = attachments[index];
            return attachment ? (
              <AuthenticatedImage key={attachment.id} uri={attachment.thumbnailUrl ?? attachment.url} cacheKey={attachment.thumbnailUrl ?? attachment.url} mimeType="image/webp" style={styles.collageCell} />
            ) : (
              <View key={`empty-${index}`} style={[styles.collageCell, styles.collageEmpty, { backgroundColor: palette.border }]}>
                <Text style={{ color: palette.faintText, fontWeight: "800" }}>{index + 1}</Text>
              </View>
            );
          })}
        </View>
      ))}
    </View>
  );
}
export function CollagePhoto({ attachment }: { attachment: CooperativeActivityEntry["attachments"][number] }) {
  const [open, setOpen] = useState(false);
  const source = useAuthorizedMedia(attachment.url);
  return (
    <>
      <Pressable accessibilityRole="imagebutton" onPress={() => setOpen(true)} style={styles.collagePhoto}>
        <AuthenticatedImage uri={attachment.url} cacheKey={attachment.id} mimeType={attachment.mimeType} style={StyleSheet.absoluteFill} />
      </Pressable>
      <ImageViewer visible={open} source={source} filename={attachment.filename} mimeType={attachment.mimeType} onClose={() => setOpen(false)} />
    </>
  );
}
export function ReadOnlyDrawing({ strokes }: { strokes: number[][][] }) {
  return (
    <View style={styles.canvas}>
      <Svg width="100%" height="100%" viewBox="0 0 300 240">
        {strokes.map((stroke, index) => (
          <Path key={index} d={stroke.map((point, i) => `${i ? "L" : "M"}${point[0] ?? 0} ${point[1] ?? 0}`).join(" ")} stroke="#19202A" strokeWidth={5} strokeLinecap="round" strokeLinejoin="round" fill="none" />
        ))}
      </Svg>
    </View>
  );
}
export function Waiting({ text }: { text: string }) {
  const palette = usePalette();
  return (
    <View style={[styles.waiting, { backgroundColor: palette.surface }]}>
      <AppIcon name="time-outline" size={25} color={palette.accent} />
      <Text style={[styles.explainer, { color: palette.secondaryText }]}>{text}</Text>
    </View>
  );
}
export function Primary({ label, disabled, busy, onPress }: { label: string; disabled: boolean; busy: boolean; onPress: () => void }) {
  const palette = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled, busy }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.primary,
        {
          backgroundColor: palette.accent,
          opacity: disabled ? 0.45 : pressed ? 0.82 : 1,
        },
      ]}
    >
      {busy ? <ActivityIndicator color="#FFF" /> : <Text style={styles.actionText}>{label}</Text>}
    </Pressable>
  );
}
export function Choice({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const palette = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={[
        styles.choice,
        {
          backgroundColor: active ? palette.accent : palette.surface,
          borderColor: active ? palette.accent : palette.border,
        },
      ]}
    >
      <Text
        numberOfLines={2}
        style={{
          color: active ? "#FFF" : palette.text,
          fontWeight: "700",
          textAlign: "center",
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function localized(value: unknown, language: "ru" | "en") {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const map = value as Record<string, unknown>;
  return typeof map[language] === "string" ? map[language] : typeof map.ru === "string" ? map.ru : "";
}
