import type { TicTacToeState } from "@snezhok/game-engine";
import { memo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { usePalette } from "../../../hooks/usePalette";

export const TicTacToeBoard = memo(function TicTacToeBoard({ state, meId, busy, run }: { state: TicTacToeState; meId: string; busy: boolean; run: (action: string, payload?: Record<string, unknown>) => Promise<boolean> }) {
  const palette = usePalette();
  const enabled = state.status === "playing" && state.turnUserId === meId && !busy;
  return (
    <View style={[styles.board, { backgroundColor: palette.border }]}>
      {state.board.map((mark, cell) => (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${Math.floor(cell / 3) + 1}, ${cell % 3 + 1}${mark ? `: ${mark}` : ""}`}
          disabled={!enabled || mark !== null}
          key={cell}
          onPress={() => void run("game-move", { cell })}
          style={({ pressed }) => [styles.cell, { backgroundColor: pressed ? palette.accentSoft : palette.elevated }]}
        >
          <Text style={[styles.mark, { color: mark === "x" ? palette.accent : palette.success }]}>{mark?.toUpperCase() ?? ""}</Text>
        </Pressable>
      ))}
    </View>
  );
});

const styles = StyleSheet.create({
  board: { width: "100%", maxWidth: 330, aspectRatio: 1, alignSelf: "center", flexDirection: "row", flexWrap: "wrap", gap: 3, borderRadius: 24, overflow: "hidden", padding: 3 },
  cell: { width: "32.65%", height: "32.65%", alignItems: "center", justifyContent: "center" },
  mark: { fontSize: 52, lineHeight: 60, fontWeight: "500" },
});
