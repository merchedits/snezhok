import { validateFleet, type SeaBattleShot, type SeaBattleState } from "@snezhok/game-engine";
import { memo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { usePalette } from "../../../hooks/usePalette";

interface Props {
  state: SeaBattleState;
  privateState: Record<string, unknown>;
  meId: string;
  busy: boolean;
  language: "ru" | "en";
  run: (action: string, payload?: Record<string, unknown>) => Promise<boolean>;
}

export const SeaBattleBoard = memo(function SeaBattleBoard({ state, privateState, meId, busy, language, run }: Props) {
  const palette = usePalette();
  const otherId = state.players.find((id) => id !== meId)!;
  const fleet = Array.isArray(privateState.fleet) && validateFleet(privateState.fleet as number[][]) ? privateState.fleet as number[][] : [];
  const ownShots = state.shots[meId] ?? [];
  const incomingShots = state.shots[otherId] ?? [];
  const ready = state.readyUserIds.includes(meId);
  const canFire = state.status === "playing" && state.turnUserId === meId && !busy;
  if (state.status === "setup") return (
    <View style={styles.section}>
      <Board title={language === "ru" ? "Ваш флот" : "Your fleet"} fleet={fleet} shots={incomingShots} disabled onCell={() => undefined} />
      <Text style={[styles.hint, { color: palette.secondaryText }]}>{language === "ru" ? "Корабли расставлены автоматически и не соприкасаются. Перемешайте поле, если хотите." : "Ships are placed automatically without touching. Shuffle until the layout feels right."}</Text>
      <View style={styles.actions}>
        <Pressable accessibilityRole="button" disabled={busy || ready} onPress={() => void run("game-shuffle")} style={[styles.secondary, { backgroundColor: palette.surface, opacity: ready ? 0.45 : 1 }]}><Text style={[styles.actionText, { color: palette.text }]}>{language === "ru" ? "Перемешать" : "Shuffle"}</Text></Pressable>
        <Pressable accessibilityRole="button" disabled={busy || ready || fleet.length === 0} onPress={() => void run("game-ready")} style={[styles.primary, { backgroundColor: palette.pop, opacity: ready ? 0.55 : 1 }]}><Text style={[styles.actionText, { color: palette.onPop }]}>{ready ? (language === "ru" ? "Готово — ждём" : "Ready — waiting") : (language === "ru" ? "Флот готов" : "Lock fleet")}</Text></Pressable>
      </View>
    </View>
  );
  const revealedEnemy = state.revealedFleets?.[otherId] ?? [];
  return (
    <View style={styles.section}>
      <Board title={language === "ru" ? "Поле соперника" : "Opponent's waters"} fleet={revealedEnemy} shots={ownShots} disabled={!canFire} onCell={(cell) => void run("game-move", { cell })} />
      <Board title={language === "ru" ? "Ваш флот" : "Your fleet"} fleet={fleet.length ? fleet : state.revealedFleets?.[meId] ?? []} shots={incomingShots} disabled onCell={() => undefined} compact />
      <Text style={[styles.legend, { color: palette.secondaryText }]}>{language === "ru" ? "● попадание   × промах   ■ корабль" : "● hit   × miss   ■ ship"}</Text>
    </View>
  );
});

function Board({ title, fleet, shots, disabled, onCell, compact = false }: { title: string; fleet: number[][]; shots: SeaBattleShot[]; disabled: boolean; onCell: (cell: number) => void; compact?: boolean }) {
  const palette = usePalette();
  const occupied = new Set(fleet.flat());
  const shotMap = new Map(shots.map((shot) => [shot.cell, shot]));
  return (
    <View style={styles.boardSection}>
      <Text style={[styles.boardTitle, { color: palette.text }]}>{title}</Text>
      <View style={[styles.board, compact && styles.compactBoard]}>
        {Array.from({ length: 100 }, (_, cell) => {
          const shot = shotMap.get(cell);
          const column = cell % 10;
          const row = Math.floor(cell / 10);
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${String.fromCharCode(65 + column)}${row + 1}`}
              disabled={disabled || Boolean(shot)}
              key={cell}
              onPress={() => onCell(cell)}
              style={({ pressed }) => [styles.cell, column === 9 && styles.lastColumn, row === 9 && styles.lastRow, occupied.has(cell) && styles.ship, pressed && styles.pressed]}
            >
              {shot ? <Text style={[styles.marker, shot.outcome === "miss" ? styles.miss : styles.hit]}>{shot.outcome === "miss" ? "×" : "●"}</Text> : null}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 12 }, boardSection: { alignItems: "center", gap: 6 }, boardTitle: { fontSize: 12, fontWeight: "800", alignSelf: "flex-start" },
  board: { width: "100%", maxWidth: 330, aspectRatio: 1, flexDirection: "row", flexWrap: "wrap", borderTopWidth: 1, borderLeftWidth: 1, borderColor: "rgba(255,255,255,0.24)", backgroundColor: "#23475C", borderRadius: 12, overflow: "hidden" },
  compactBoard: { maxWidth: 230 },
  cell: { width: "10%", height: "10%", borderTopWidth: 0, borderLeftWidth: 0, borderColor: "rgba(255,255,255,0.22)", alignItems: "center", justifyContent: "center", borderRightWidth: 1, borderBottomWidth: 1 },
  lastColumn: { borderRightWidth: 1 }, lastRow: { borderBottomWidth: 1 }, ship: { backgroundColor: "#8067AB" }, pressed: { backgroundColor: "#D7FF29" },
  marker: { fontSize: 13, lineHeight: 15, fontWeight: "900" }, hit: { color: "#FF7A9B" }, miss: { color: "rgba(255,255,255,0.7)" },
  actions: { flexDirection: "row", gap: 9 }, primary: { flex: 1.25, minHeight: 48, borderRadius: 15, alignItems: "center", justifyContent: "center" }, secondary: { flex: 1, minHeight: 48, borderRadius: 15, alignItems: "center", justifyContent: "center" }, actionText: { fontSize: 13, fontWeight: "800" },
  hint: { fontSize: 12, lineHeight: 17 }, legend: { fontSize: 11, textAlign: "center" },
});
