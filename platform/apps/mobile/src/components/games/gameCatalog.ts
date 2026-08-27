import type { GameKind } from "@snezhok/game-engine";
import type { AppIconName } from "../AppIcon";

export const gameCatalog: Record<GameKind, { icon: AppIconName; ru: string; en: string; fill: string; ink: string }> = {
  "tic-tac-toe": { icon: "grid-nine-outline", ru: "Крестики-нолики", en: "Tic-tac-toe", fill: "#D7FF72", ink: "#243500" },
  chess: { icon: "crown-outline", ru: "Шахматы", en: "Chess", fill: "#CDB5FF", ink: "#4C2A83" },
  checkers: { icon: "checkerboard-outline", ru: "Русские шашки", en: "Russian checkers", fill: "#B5EBD1", ink: "#15553A" },
  "sea-battle": { icon: "boat-outline", ru: "Морской бой", en: "Battleship", fill: "#B9D8FF", ink: "#174C75" },
  pool: { icon: "pool-outline", ru: "Бильярд 8-ball", en: "8-ball pool", fill: "#BFA7FF", ink: "#3E2377" },
};
