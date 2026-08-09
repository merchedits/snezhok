import { randomInt } from "node:crypto";
import type { CooperativeActivityType } from "@snezhok/contracts";

export interface LocalizedText { ru: string; en: string; }
export interface ChoicePrompt { id: string; left: LocalizedText; right: LocalizedText; }

const questions: Record<string, LocalizedText[]> = {
  silly: [
    { ru: "Какой бесполезный талант ты хотел(а) бы получить?", en: "Which useless talent would you love to have?" },
    { ru: "Если бы наш чат был животным, каким?", en: "If our chat were an animal, which one would it be?" },
    { ru: "Какую еду ты смог(ла) бы есть неделю подряд?", en: "Which food could you eat for a week straight?" },
  ],
  childhood: [
    { ru: "Какая мелочь мгновенно возвращает тебя в детство?", en: "What tiny thing instantly takes you back to childhood?" },
    { ru: "О какой детской мечте ты всё ещё иногда думаешь?", en: "Which childhood dream do you still think about?" },
    { ru: "Какая семейная традиция тебе особенно дорога?", en: "Which family tradition means the most to you?" },
  ],
  preferences: [
    { ru: "Как выглядит твой идеальный ленивый выходной?", en: "What would your perfect lazy Sunday look like?" },
    { ru: "Какое место ты всегда рад(а) посетить снова?", en: "Which place are you always happy to revisit?" },
    { ru: "Какой маленький подарок тебя бы сейчас порадовал?", en: "Which small gift would make you happy right now?" },
  ],
  hypothetical: [
    { ru: "Если бы завтра был полностью свободный день, что бы мы сделали?", en: "If tomorrow were completely free, what would we do?" },
    { ru: "Куда бы ты телепортировался(-ась) на один вечер?", en: "Where would you teleport for one evening?" },
    { ru: "Какую эпоху ты бы посетил(а) на сутки?", en: "Which era would you visit for one day?" },
  ],
  deep: [
    { ru: "Когда ты чувствуешь, что тебя действительно понимают?", en: "When do you feel truly understood?" },
    { ru: "Что для тебя означает ощущение дома?", en: "What does feeling at home mean to you?" },
    { ru: "Какую свою черту ты научился(-ась) ценить?", en: "Which part of yourself have you learned to appreciate?" },
  ],
  romantic: [
    { ru: "Какой наш обычный момент тебе особенно дорог?", en: "Which ordinary moment of ours feels especially precious?" },
    { ru: "Как я могу сделать твой сложный день чуть легче?", en: "How can I make a difficult day a little easier for you?" },
    { ru: "Какое маленькое совместное приключение устроим следующим?", en: "Which small adventure should we have next?" },
  ],
  nsfw: [
    { ru: "О чём тебе хотелось бы говорить со мной смелее?", en: "What would you like to talk about more boldly with me?" },
    { ru: "Что помогает тебе чувствовать близость и безопасность?", en: "What helps you feel close and safe?" },
    { ru: "Какой флирт тебе нравится больше всего?", en: "What kind of flirting do you enjoy most?" },
  ],
};

export const blitzPrompts: ChoicePrompt[] = [
  choice("cats-dogs", "Кошки", "Cats", "Собаки", "Dogs"),
  choice("sunrise-sunset", "Рассвет", "Sunrise", "Закат", "Sunset"),
  choice("sweet-salty", "Сладкое", "Sweet", "Солёное", "Salty"),
  choice("home-out", "Остаться дома", "Stay home", "Куда-нибудь пойти", "Go out"),
  choice("voice-text", "Голосовые", "Voice messages", "Текст", "Text"),
  choice("plan-spontaneous", "План", "A plan", "Спонтанность", "Spontaneous"),
  choice("mountains-sea", "Горы", "Mountains", "Море", "Sea"),
  choice("movie-series", "Фильм", "Movie", "Сериал", "Series"),
  choice("early-late", "Рано вставать", "Early bird", "Поздно ложиться", "Night owl"),
  choice("cook-order", "Готовить", "Cook", "Заказывать", "Order in"),
  choice("photo-video", "Фото", "Photo", "Видео", "Video"),
  choice("city-nature", "Город", "City", "Природа", "Nature"),
];

export const tinyQuests: LocalizedText[] = [
  { ru: "Сфотографируй предмет вокруг любимого цвета", en: "Photograph something nearby in your favourite colour" },
  { ru: "Покажи самый странный предмет рядом", en: "Show the weirdest object near you" },
  { ru: "Покажи, что ты сейчас пьёшь", en: "Show what you are drinking right now" },
  { ru: "Найди вещь, которая напоминает о детстве", en: "Find something that reminds you of childhood" },
  { ru: "Сфотографируй самый уютный угол рядом", en: "Photograph the cosiest corner near you" },
];

export const songPrompts: LocalizedText[] = [
  { ru: "Песня, которая вызывает ностальгию", en: "A song that makes you nostalgic" },
  { ru: "Песня, которую ты включил(а) бы в два часа ночи", en: "A song you would play at 2 AM" },
  { ru: "Песня для совместной поездки", en: "A song for a road trip together" },
  { ru: "Песня, которую хочется услышать впервые снова", en: "A song you wish you could hear for the first time again" },
];

export const drawWords: LocalizedText[] = [
  { ru: "снеговик", en: "snowman" }, { ru: "чайник", en: "kettle" },
  { ru: "жираф", en: "giraffe" }, { ru: "космонавт", en: "astronaut" },
  { ru: "пингвин", en: "penguin" }, { ru: "торт", en: "cake" },
  { ru: "велосипед", en: "bicycle" }, { ru: "облако", en: "cloud" },
];

export const huntColors = [
  { id: "blue", hex: "#4F86F7", name: { ru: "Синий", en: "Blue" } },
  { id: "orange", hex: "#FF8A3D", name: { ru: "Оранжевый", en: "Orange" } },
  { id: "green", hex: "#59C884", name: { ru: "Зелёный", en: "Green" } },
  { id: "pink", hex: "#F47783", name: { ru: "Розовый", en: "Pink" } },
  { id: "purple", hex: "#A574E8", name: { ru: "Фиолетовый", en: "Purple" } },
  { id: "yellow", hex: "#F4CC58", name: { ru: "Жёлтый", en: "Yellow" } },
] as const;

export function initialActivityConfiguration(type: CooperativeActivityType, options: Record<string, unknown>, participantIds: string[]) {
  switch (type) {
    case "question": {
      const category = typeof options.category === "string" && questions[options.category] ? options.category : "random";
      const pool = questionPool(category, options.matureAllowed === true);
      return { config: { prompt: pick(pool), category, secret: options.secret !== false }, privateByUser: {} };
    }
    case "blitz": {
      const count = integerBetween(options.count, 5, 10, 8);
      return { config: { prompts: sample(blitzPrompts, count) }, privateByUser: {} };
    }
    case "tiny-quest": return { config: { prompt: pick(tinyQuests) }, privateByUser: {} };
    case "color-hunt": {
      const colors = sample(huntColors, Math.max(2, participantIds.length));
      return { config: { target: 9 }, privateByUser: Object.fromEntries(participantIds.map((id, index) => [id, { color: colors[index] }])) };
    }
    case "song-exchange": return { config: { prompt: pick(songPrompts) }, privateByUser: {} };
    case "draw-guess": {
      const drawerId = participantIds[randomInt(participantIds.length)]!;
      return { config: { drawerId }, privateByUser: { [drawerId]: { word: pick(drawWords) } } };
    }
    case "memory-capsule": {
      const months = integerBetween(options.months, 1, 6, 1);
      return { config: { months }, privateByUser: {} };
    }
    case "movie-list": return { config: { title: { ru: "Наши фильмы", en: "Our movies" } }, privateByUser: {} };
    case "ideas-jar": return { config: { title: { ru: "Банка идей", en: "Ideas jar" } }, privateByUser: {} };
    case "milestone": return { config: { milestone: options.milestone ?? "first-activity" }, privateByUser: {} };
  }
}

export function questionPool(category: string, matureAllowed: boolean): LocalizedText[] {
  if (category !== "random" && questions[category]) return [...questions[category]!];
  return Object.entries(questions).filter(([name]) => matureAllowed || (name !== "romantic" && name !== "nsfw")).flatMap(([, prompts]) => prompts);
}

function choice(id: string, leftRu: string, leftEn: string, rightRu: string, rightEn: string): ChoicePrompt {
  return { id, left: { ru: leftRu, en: leftEn }, right: { ru: rightRu, en: rightEn } };
}

function pick<T>(items: readonly T[]): T { return items[randomInt(items.length)]!; }

function sample<T>(items: readonly T[], count: number): T[] {
  const remaining = [...items];
  const result: T[] = [];
  while (remaining.length && result.length < count) result.push(remaining.splice(randomInt(remaining.length), 1)[0]!);
  return result;
}

function integerBetween(value: unknown, min: number, max: number, fallback: number) {
  return typeof value === "number" && Number.isInteger(value) ? Math.max(min, Math.min(max, value)) : fallback;
}
