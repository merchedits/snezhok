import type { CooperativeActivityEntry, CooperativeActivityParticipant } from "@snezhok/contracts";
import { useMemo, useRef } from "react";
import { ActivityIndicator, PanResponder, Pressable, Text, TextInput, View } from "react-native";
import Svg, { Path } from "react-native-svg";

import { usePalette } from "../../hooks/usePalette";
import { clearRealtimeDrawing } from "../../lib/realtimeBridge";
import { AppIcon } from "../AppIcon";
import { useAppDialog } from "../AppDialogProvider";
import { CollageGrid, CollagePhoto, ReadOnlyDrawing, Waiting, Primary, Choice, localized } from "./CooperativeActivityShared";
import { attemptStyle, cooperativeActivityStyles as styles, iconActionStyle } from "./cooperativeActivityStyles";

export function QuestionInput({ value, onChange, ownEntry, secret, onSubmit, busy, language }: { value: string; onChange: (value: string) => void; ownEntry?: CooperativeActivityEntry | undefined; secret: boolean; onSubmit: () => void; busy: boolean; language: "ru" | "en" }) {
  const palette = usePalette();
  if (ownEntry) return <Waiting text={secret ? (language === "ru" ? "Твой ответ сохранён. Ответ другого человека останется скрыт до общего открытия." : "Your answer is saved. The other answer stays hidden until the shared reveal.") : language === "ru" ? "Твой ответ уже в чате. Ждём второй ответ." : "Your answer is in the chat. Waiting for the other answer."} />;
  return (
    <>
      <TextInput
        multiline
        autoFocus
        value={value}
        onChangeText={onChange}
        maxLength={4_000}
        placeholder={language === "ru" ? "Твой честный ответ…" : "Your honest answer…"}
        placeholderTextColor={palette.faintText}
        style={[
          styles.largeInput,
          {
            color: palette.text,
            backgroundColor: palette.surface,
            borderColor: palette.border,
          },
        ]}
      />
      <Primary label={secret ? (language === "ru" ? "Ответить тайно" : "Answer secretly") : language === "ru" ? "Ответить" : "Answer"} disabled={busy || !value.trim()} busy={busy} onPress={onSubmit} />
    </>
  );
}

export function BlitzInput({ prompts, answers, setAnswers, onSubmit, busy, language }: { prompts: unknown; answers: Array<"left" | "right" | null>; setAnswers: (value: Array<"left" | "right" | null>) => void; onSubmit: () => void; busy: boolean; language: "ru" | "en" }) {
  const palette = usePalette();
  const list = Array.isArray(prompts) ? (prompts as Array<Record<string, unknown>>) : [];
  return (
    <>
      {list.map((prompt, index) => (
        <View key={String(prompt.id ?? index)} style={styles.blitzRow}>
          <Choice label={localized(prompt.left, language)} active={answers[index] === "left"} onPress={() => setAnswers(answers.map((answer, i) => (i === index ? "left" : answer)))} />
          <Text style={[styles.or, { color: palette.faintText }]}>·</Text>
          <Choice label={localized(prompt.right, language)} active={answers[index] === "right"} onPress={() => setAnswers(answers.map((answer, i) => (i === index ? "right" : answer)))} />
        </View>
      ))}
      <Primary label={language === "ru" ? "Готово" : "Done"} disabled={busy || answers.some((answer) => answer === null)} busy={busy} onPress={onSubmit} />
    </>
  );
}

export function PhotoInput({ activityType, text, onChange, onPick, busy, ownPhotos, ownCollage, assignedColor, language }: { activityType: string; text: string; onChange: (v: string) => void; onPick: () => void; busy: boolean; ownPhotos: CooperativeActivityEntry["attachments"]; ownCollage?: CooperativeActivityEntry["attachments"][number] | undefined; assignedColor?: unknown; language: "ru" | "en" }) {
  const palette = usePalette();
  const ownCount = ownPhotos.length;
  const color = assignedColor && typeof assignedColor === "object" ? (assignedColor as { hex?: unknown; name?: unknown }) : null;
  const colorName = localized(color?.name, language);
  return (
    <>
      {activityType === "color-hunt" && color ? (
        <View style={[styles.colorAssignment, { backgroundColor: palette.surface }]}>
          <View
            style={[
              styles.colorDot,
              {
                backgroundColor: typeof color.hex === "string" ? color.hex : palette.accent,
              },
            ]}
          />
          <View style={styles.flex}>
            <Text style={[styles.itemMeta, { color: palette.secondaryText }]}>{language === "ru" ? "Твой цвет" : "Your colour"}</Text>
            <Text style={[styles.itemTitle, { color: palette.text }]}>{colorName || String(color.hex ?? "")}</Text>
          </View>
        </View>
      ) : null}
      <Text style={[styles.explainer, { color: palette.secondaryText }]}>{activityType === "color-hunt" ? (ownCount >= 9 ? (ownCollage ? (language === "ru" ? "Коллаж готов — его можно открыть и сохранить." : "Your collage is ready — open it to save or share.") : language === "ru" ? "Собираем PNG‑коллаж 1080×1080…" : "Building your 1080×1080 PNG collage…") : language === "ru" ? `Твоя доска: ${ownCount}/9. Можно выбрать сразу все оставшиеся снимки.` : `Your board: ${ownCount}/9. You can select all remaining photos at once.`) : language === "ru" ? "Ваши снимки откроются только после вклада обоих." : "Your photos unlock only after both people contribute."}</Text>
      {activityType === "color-hunt" ? (
        ownCollage ? (
          <CollagePhoto attachment={ownCollage} />
        ) : (
          <>
            <CollageGrid attachments={ownPhotos} />
            {ownCount >= 9 ? (
              <View style={styles.collageLoading}>
                <ActivityIndicator color={palette.accent} />
                <Text style={[styles.itemMeta, { color: palette.secondaryText }]}>{language === "ru" ? "Генерируем итоговый файл…" : "Generating the final file…"}</Text>
              </View>
            ) : null}
          </>
        )
      ) : (
        <TextInput value={text} onChangeText={onChange} maxLength={500} placeholder={language === "ru" ? "Подпись — необязательно" : "Optional caption"} placeholderTextColor={palette.faintText} style={[styles.input, { color: palette.text, backgroundColor: palette.surface }]} />
      )}
      <Primary label={activityType === "color-hunt" ? (language === "ru" ? "Снять или выбрать фото" : "Take or choose photos") : language === "ru" ? "Выбрать фото" : "Choose photo"} disabled={busy || ownCount >= 9} busy={busy} onPress={onPick} />
    </>
  );
}

export function SongInput({ title, setTitle, url, setUrl, onSubmit, busy, language }: { title: string; setTitle: (v: string) => void; url: string; setUrl: (v: string) => void; onSubmit: () => void; busy: boolean; language: "ru" | "en" }) {
  const palette = usePalette();
  return (
    <>
      <Text style={[styles.explainer, { color: palette.secondaryText }]}>{language === "ru" ? "В Яндекс Музыке нажми «Поделиться» и вставь ссылку — карточка откроется прямо в приложении Музыки." : "Use Share in Yandex Music and paste the link—the card opens directly in the Music app."}</Text>
      <TextInput value={title} onChangeText={setTitle} maxLength={200} placeholder={language === "ru" ? "Название песни" : "Song title"} placeholderTextColor={palette.faintText} style={[styles.input, { color: palette.text, backgroundColor: palette.surface }]} />
      <TextInput value={url} onChangeText={setUrl} autoCapitalize="none" keyboardType="url" maxLength={2_048} placeholder="https://music.yandex.ru/…" placeholderTextColor={palette.faintText} style={[styles.input, { color: palette.text, backgroundColor: palette.surface }]} />
      <Primary label={language === "ru" ? "Добавить песню" : "Add song"} disabled={busy || !title.trim() || !url.trim()} busy={busy} onPress={onSubmit} />
    </>
  );
}

export function MovieList({ entries, participants, meId, title, setTitle, selected, setSelected, pickedId, run, busy, language }: { entries: CooperativeActivityEntry[]; participants: CooperativeActivityParticipant[]; meId?: string | undefined; title: string; setTitle: (v: string) => void; selected: string | null; setSelected: (v: string | null) => void; pickedId: string | null; run: (a: string, p?: Record<string, unknown>) => Promise<boolean>; busy: boolean; language: "ru" | "en" }) {
  const palette = usePalette();
  const showDialog = useAppDialog();
  const picked = entries.find((entry) => entry.id === pickedId);
  const confirmRemove = (entry: CooperativeActivityEntry) =>
    showDialog(language === "ru" ? "Удалить фильм?" : "Remove movie?", String(entry.payload.title ?? ""), [
      { text: language === "ru" ? "Отмена" : "Cancel", style: "cancel" },
      {
        text: language === "ru" ? "Удалить" : "Remove",
        style: "destructive",
        onPress: () => void run("remove-item", { entryId: entry.id }),
      },
    ]);
  return (
    <>
      <View style={styles.addLine}>
        <TextInput accessibilityLabel={language === "ru" ? "Добавить фильм" : "Add a movie"} value={title} onChangeText={setTitle} maxLength={200} placeholder={language === "ru" ? "Добавить фильм" : "Add a movie"} placeholderTextColor={palette.faintText} style={[styles.inlineInput, { color: palette.text, backgroundColor: palette.surface }]} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={language === "ru" ? "Добавить фильм" : "Add movie"}
          disabled={!title.trim() || busy}
          onPress={() => {
            void run("add-item", { title }).then((saved) => {
              if (saved) setTitle("");
            });
          }}
          style={[styles.plus, { backgroundColor: palette.accent }]}
        >
          <AppIcon name="add" size={22} color="#FFF" />
        </Pressable>
      </View>
      {picked ? (
        <View style={[styles.picked, { backgroundColor: palette.accentSoft }]}>
          <Text style={[styles.itemMeta, { color: palette.accent }]}>{language === "ru" ? "Сегодня смотрим" : "Tonight's pick"}</Text>
          <Text style={[styles.pickedTitle, { color: palette.text }]}>{String(picked.payload.title ?? "")}</Text>
          <View style={styles.pickActions}>
            <Pressable accessibilityRole="button" disabled={busy} onPress={() => void run("reroll")}>
              <Text style={{ color: palette.accent, fontWeight: "700" }}>{language === "ru" ? "Перевыбрать" : "Reroll"}</Text>
            </Pressable>
            <Pressable accessibilityRole="button" disabled={busy} onPress={() => void run("confirm", { entryId: picked.id, status: "watched" })}>
              <Text style={{ color: palette.success, fontWeight: "800" }}>{language === "ru" ? "Посмотрели" : "Watched"}</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
      {entries.map((entry) => (
        <View key={entry.id} style={[styles.listItem, { borderColor: palette.border }]}>
          <Pressable accessibilityRole="button" accessibilityLabel={String(entry.payload.title ?? "")} style={styles.flex} onPress={() => setSelected(selected === entry.id ? null : entry.id)}>
            <Text style={[styles.itemTitle, { color: palette.text }]}>{String(entry.payload.title ?? "")}</Text>
            <Text style={[styles.itemMeta, { color: palette.secondaryText }]}>
              {entry.payload.combinedRating ? `${entry.payload.combinedRating}/10` : language === "ru" ? "Без оценки" : "Not rated"} · {entry.payload.status === "watched" ? (language === "ru" ? "просмотрено" : "watched") : language === "ru" ? "хотим посмотреть" : "want to watch"}
            </Text>
            {ratingLabels(entry.payload.ratings, participants).map((label) => (
              <Text key={label} style={[styles.itemMeta, { color: palette.secondaryText }]}>
                {label}
              </Text>
            ))}
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={language === "ru" ? "Изменить статус просмотра" : "Change watched status"}
            disabled={busy}
            onPress={() =>
              void run("set-status", {
                entryId: entry.id,
                status: entry.payload.status === "watched" ? "want" : "watched",
              })
            }
            style={iconActionStyle}
          >
            <AppIcon name="checkmark" size={20} color={palette.accent} />
          </Pressable>
          {entry.createdBy === meId ? (
            <Pressable accessibilityRole="button" accessibilityLabel={language === "ru" ? "Удалить фильм" : "Remove movie"} disabled={busy} onPress={() => confirmRemove(entry)} style={iconActionStyle}>
              <AppIcon name="trash-outline" size={19} color={palette.danger} />
            </Pressable>
          ) : null}
          {selected === entry.id ? (
            <View style={styles.ratings}>
              {Array.from({ length: 10 }, (_, i) => i + 1).map((rating) => (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={String(rating)}
                  key={rating}
                  onPress={() => {
                    setSelected(null);
                    void run("rate", { entryId: entry.id, rating });
                  }}
                  style={[styles.rating, { backgroundColor: palette.accentSoft }]}
                >
                  <Text style={{ color: palette.accent, fontWeight: "800" }}>{rating}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
        </View>
      ))}
      <Primary label={picked ? (language === "ru" ? "Другой случайный фильм" : "Pick another") : language === "ru" ? "Выбрать случайный фильм" : "Pick a random movie"} disabled={busy || !entries.some((entry) => entry.payload.status === "want")} busy={busy} onPress={() => void run(picked ? "reroll" : "pick")} />
    </>
  );
}

function ratingLabels(value: unknown, participants: CooperativeActivityParticipant[]) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.entries(value as Record<string, unknown>).flatMap(([userId, rating]) => (typeof rating === "number" ? [`${participants.find((participant) => participant.user.id === userId)?.user.displayName ?? "—"}: ${rating}/10`] : []));
}

export function IdeasJar({ entries, meId, title, setTitle, selectedId, run, busy, language }: { entries: CooperativeActivityEntry[]; meId?: string | undefined; title: string; setTitle: (v: string) => void; selectedId: string | null; run: (a: string, p?: Record<string, unknown>) => Promise<boolean>; busy: boolean; language: "ru" | "en" }) {
  const palette = usePalette();
  const showDialog = useAppDialog();
  const confirmRemove = (entry: CooperativeActivityEntry) =>
    showDialog(language === "ru" ? "Удалить идею?" : "Remove idea?", String(entry.payload.title ?? ""), [
      { text: language === "ru" ? "Отмена" : "Cancel", style: "cancel" },
      {
        text: language === "ru" ? "Удалить" : "Remove",
        style: "destructive",
        onPress: () => void run("remove-item", { entryId: entry.id }),
      },
    ]);
  return (
    <>
      <View style={styles.addLine}>
        <TextInput accessibilityLabel={language === "ru" ? "Новая идея" : "New idea"} value={title} onChangeText={setTitle} maxLength={240} placeholder={language === "ru" ? "Новая идея" : "New idea"} placeholderTextColor={palette.faintText} style={[styles.inlineInput, { color: palette.text, backgroundColor: palette.surface }]} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={language === "ru" ? "Добавить идею" : "Add idea"}
          disabled={!title.trim() || busy}
          onPress={() => {
            void run("add-item", { title }).then((saved) => {
              if (saved) setTitle("");
            });
          }}
          style={[styles.plus, { backgroundColor: palette.accent }]}
        >
          <AppIcon name="add" size={22} color="#FFF" />
        </Pressable>
      </View>
      {selectedId ? (
        <View style={[styles.picked, { backgroundColor: palette.accentSoft }]}>
          <Text style={[styles.itemMeta, { color: palette.accent }]}>{language === "ru" ? "Сегодня выбираем" : "Today's pick"}</Text>
          <Text style={[styles.pickedTitle, { color: palette.text }]}>{String(entries.find((entry) => entry.id === selectedId)?.payload.title ?? "")}</Text>
          <View style={styles.pickActions}>
            <Pressable accessibilityRole="button" disabled={busy} onPress={() => void run("reroll")}>
              <Text style={{ color: palette.accent, fontWeight: "700" }}>{language === "ru" ? "Ещё раз" : "Reroll"}</Text>
            </Pressable>
            <Pressable accessibilityRole="button" disabled={busy} onPress={() => void run("complete", { entryId: selectedId })}>
              <Text style={{ color: palette.success, fontWeight: "800" }}>{language === "ru" ? "Сделали" : "Done"}</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
      {entries.map((entry) => (
        <View key={entry.id} style={[styles.listItem, { borderColor: palette.border }]}>
          <Text
            style={[
              styles.flex,
              styles.itemTitle,
              {
                color: palette.text,
                textDecorationLine: entry.payload.status === "done" ? "line-through" : "none",
              },
            ]}
          >
            {String(entry.payload.title ?? "")}
          </Text>
          {entry.createdBy === meId ? (
            <Pressable accessibilityRole="button" accessibilityLabel={language === "ru" ? "Удалить идею" : "Remove idea"} disabled={busy} onPress={() => confirmRemove(entry)} style={iconActionStyle}>
              <AppIcon name="trash-outline" size={19} color={palette.danger} />
            </Pressable>
          ) : null}
        </View>
      ))}
      <Primary label={language === "ru" ? "Вытянуть идею" : "Pick an idea"} disabled={busy || !entries.some((entry) => entry.payload.status === "planned")} busy={busy} onPress={() => void run("pick")} />
    </>
  );
}

export function DrawGuess({ activityId, drawerId, meId, drawing, liveDrawing, setDrawing, guess, setGuess, run, busy, language, privateState, storedDrawing, attempts }: { activityId: string; drawerId: string; meId?: string | undefined; drawing: number[][][]; liveDrawing: number[][][]; setDrawing: (v: number[][][]) => void; guess: string; setGuess: (v: string) => void; run: (a: string, p?: Record<string, unknown>) => Promise<boolean>; busy: boolean; language: "ru" | "en"; privateState: Record<string, unknown>; storedDrawing?: CooperativeActivityEntry | undefined; attempts: CooperativeActivityEntry[] }) {
  const palette = usePalette();
  const drawer = drawerId === meId;
  const saved = Array.isArray(storedDrawing?.payload.strokes) ? (storedDrawing.payload.strokes as number[][][]) : [];
  if (drawer && storedDrawing)
    return (
      <>
        <ReadOnlyDrawing strokes={saved} />
        <Waiting text={language === "ru" ? "Рисунок отправлен. Теперь очередь угадывающего." : "Drawing sent. Now it is the guesser's turn."} />
        <GuessAttempts attempts={attempts} language={language} />
      </>
    );
  if (drawer)
    return (
      <>
        <Text style={[styles.explainer, { color: palette.secondaryText }]}>
          {language === "ru" ? "Нарисуй: " : "Draw: "}
          <Text style={{ color: palette.text, fontWeight: "800" }}>{localized(privateState.word, language)}</Text>
        </Text>
        <DrawingCanvas strokes={drawing} onChange={setDrawing} />
        <View style={styles.pickActions}>
          <Pressable onPress={() => setDrawing([])}>
            <Text style={{ color: palette.secondaryText }}>{language === "ru" ? "Очистить" : "Clear"}</Text>
          </Pressable>
        </View>
        <Primary
          label={language === "ru" ? "Готово" : "Done"}
          disabled={busy || !drawing.length}
          busy={busy}
          onPress={() =>
            void run("submit-drawing", {
              strokes: drawing,
              width: 300,
              height: 240,
            }).then((savedResult) => {
              if (savedResult) clearRealtimeDrawing(activityId);
            })
          }
        />
      </>
    );
  const visibleDrawing = saved.length ? saved : liveDrawing;
  return (
    <>
      <ReadOnlyDrawing strokes={visibleDrawing} />
      {!storedDrawing ? <Text style={[styles.liveLabel, { color: palette.secondaryText }]}>{visibleDrawing.length ? (language === "ru" ? "Художник рисует прямо сейчас — уже можно угадывать." : "The artist is drawing live — start guessing now.") : language === "ru" ? "Ждём первый штрих…" : "Waiting for the first stroke…"}</Text> : null}
      <GuessAttempts attempts={attempts} language={language} />
      <TextInput accessibilityLabel={language === "ru" ? "Твоя догадка" : "Your guess"} value={guess} onChangeText={setGuess} maxLength={100} placeholder={language === "ru" ? "Твоя догадка" : "Your guess"} placeholderTextColor={palette.faintText} style={[styles.input, { color: palette.text, backgroundColor: palette.surface }]} />
      <Primary
        label={language === "ru" ? "Угадать" : "Guess"}
        disabled={busy || !guess.trim()}
        busy={busy}
        onPress={() =>
          void run("guess", { guess }).then((savedResult) => {
            if (savedResult) setGuess("");
          })
        }
      />
    </>
  );
}

function GuessAttempts({ attempts, language }: { attempts: CooperativeActivityEntry[]; language: "ru" | "en" }) {
  const palette = usePalette();
  if (!attempts.length) return null;
  return (
    <View accessibilityLiveRegion="polite" style={{ marginTop: 10 }}>
      {attempts.slice(-3).map((attempt) => (
        <View key={attempt.id} style={attemptStyle}>
          <AppIcon name={attempt.payload.correct ? "checkmark" : "close"} size={16} color={attempt.payload.correct ? palette.success : palette.danger} />
          <Text numberOfLines={1} style={[styles.flex, styles.itemMeta, { color: palette.secondaryText }]}>
            {String(attempt.payload.guess ?? (language === "ru" ? "Попытка" : "Attempt"))}
          </Text>
        </View>
      ))}
    </View>
  );
}

function DrawingCanvas({ strokes, onChange }: { strokes: number[][][]; onChange: (value: number[][][]) => void }) {
  const current = useRef<number[][]>([]);
  const strokesRef = useRef(strokes);
  const base = useRef<number[][][]>([]);
  const size = useRef({ width: 300, height: 240 });
  strokesRef.current = strokes;
  const point = (x: number, y: number): [number, number] => [Math.round(Math.max(0, Math.min(300, (x / size.current.width) * 300)) * 10) / 10, Math.round(Math.max(0, Math.min(240, (y / size.current.height) * 240)) * 10) / 10];
  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (event) => {
          base.current = strokesRef.current.slice(0, 199);
          current.current = [point(event.nativeEvent.locationX, event.nativeEvent.locationY)];
        },
        onPanResponderMove: (event) => {
          const total = base.current.reduce((count, stroke) => count + stroke.length, 0) + current.current.length;
          if (current.current.length >= 500 || total >= 2_000) return;
          const next = point(event.nativeEvent.locationX, event.nativeEvent.locationY);
          const previous = current.current.at(-1)!;
          if (Math.hypot(next[0]! - previous[0]!, next[1]! - previous[1]!) < 1.5) return;
          current.current.push(next);
          onChange([...base.current, [...current.current]]);
        },
        onPanResponderRelease: () => {
          if (current.current.length === 1) {
            const first = current.current[0]!;
            const x = first[0] ?? 0;
            const y = first[1] ?? 0;
            onChange([
              ...base.current,
              [
                [x, y],
                [Math.min(300, x + 0.5), y],
              ],
            ]);
          }
          current.current = [];
          base.current = strokesRef.current;
        },
      }),
    [onChange],
  );
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel="Drawing canvas"
      onLayout={(event) => {
        size.current = {
          width: Math.max(1, event.nativeEvent.layout.width),
          height: Math.max(1, event.nativeEvent.layout.height),
        };
      }}
      {...responder.panHandlers}
      style={styles.canvas}
    >
      <Svg width="100%" height="100%" viewBox="0 0 300 240">
        {strokes.map((stroke, index) => (
          <Path key={index} d={stroke.map((coordinate, i) => `${i ? "L" : "M"}${coordinate[0] ?? 0} ${coordinate[1] ?? 0}`).join(" ")} stroke="#19202A" strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" fill="none" />
        ))}
      </Svg>
    </View>
  );
}

export function MemoryInput({ text, setText, songUrl, setSongUrl, onSubmit, onPick, busy, language }: { text: string; setText: (v: string) => void; songUrl: string; setSongUrl: (v: string) => void; onSubmit: () => void; onPick: () => void; busy: boolean; language: "ru" | "en" }) {
  const palette = usePalette();
  return (
    <>
      <Text style={[styles.explainer, { color: palette.secondaryText }]}>{language === "ru" ? "Добавь сообщение, фото или песню. После вклада обоих капсула закроется до даты открытия." : "Add a note, photo, or song. Once both contribute, the capsule locks until reveal day."}</Text>
      <TextInput
        multiline
        value={text}
        onChangeText={setText}
        maxLength={4_000}
        placeholder={language === "ru" ? "Что хочется сохранить?" : "What should be remembered?"}
        placeholderTextColor={palette.faintText}
        style={[
          styles.largeInput,
          {
            color: palette.text,
            backgroundColor: palette.surface,
            borderColor: palette.border,
          },
        ]}
      />
      <TextInput value={songUrl} onChangeText={setSongUrl} autoCapitalize="none" keyboardType="url" maxLength={2_048} placeholder={language === "ru" ? "Ссылка на песню — необязательно" : "Optional song link"} placeholderTextColor={palette.faintText} style={[styles.input, { color: palette.text, backgroundColor: palette.surface }]} />
      <View style={styles.twoActions}>
        <Pressable disabled={busy} onPress={onPick} style={[styles.secondaryButton, { backgroundColor: palette.surface }]}>
          <AppIcon name="images-outline" size={20} color={palette.accent} />
          <Text style={{ color: palette.accent, fontWeight: "800" }}>{language === "ru" ? "Фото" : "Photo"}</Text>
        </Pressable>
        <Pressable
          disabled={busy || (!text.trim() && !songUrl.trim())}
          onPress={onSubmit}
          style={[
            styles.primarySmall,
            {
              backgroundColor: palette.accent,
              opacity: !text.trim() && !songUrl.trim() ? 0.45 : 1,
            },
          ]}
        >
          <Text style={styles.actionText}>{language === "ru" ? "Сохранить" : "Save"}</Text>
        </Pressable>
      </View>
    </>
  );
}
