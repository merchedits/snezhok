import type { TicTacToeState } from "@snezhok/game-engine";
import { memo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { usePalette } from "../../../hooks/usePalette";

export const TicTacToeBoard = memo(function TicTacToeBoard({ state, meId, busy, run }: { state: TicTacToeState; meId: string; busy: boolean; run: (action: string, payload?: Record<string, unknown>) => Promise<boolean> }) {
  const palette = usePalette();
  const enabled = state.status === "playing" && state.turnUserId === meId && !busy;
  return (
    <View style={[styles.board, { backgroundColor: palette.elevated, borderColor: palette.border }]}>
      {[0, 1, 2].map((row) => <View key={row} style={styles.row}>
        {[0, 1, 2].map((column) => {
          const cell = row * 3 + column;
          const mark = state.board[cell];
          return <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${row + 1}, ${column + 1}${mark ? `: ${mark}` : ""}`}
            disabled={!enabled || mark !== null}
            key={cell}
            onPress={() => void run("game-move", { cell })}
            style={({ pressed }) => [styles.cell, row < 2 && styles.rowDivider, column < 2 && styles.columnDivider, { borderColor: palette.border, backgroundColor: pressed ? palette.accentSoft : palette.elevated }]}
          >
            <Text allowFontScaling={false} style={[styles.mark, { color: mark === "x" ? palette.accent : palette.success }]}>{mark?.toUpperCase() ?? ""}</Text>
          </Pressable>;
        })}
      </View>)}
    </View>
  );
});

const styles = StyleSheet.create({
  board: { width: "100%", maxWidth: 344, aspectRatio: 1, alignSelf: "center", borderWidth: 3, borderRadius: 24, overflow: "hidden" },
  row: { flex: 1, flexDirection: "row" },
  cell: { flex: 1, alignItems: "center", justifyContent: "center" }, rowDivider: { borderBottomWidth: 3 }, columnDivider: { borderRightWidth: 3 },
  mark: { fontSize: 52, lineHeight: 60, fontWeight: "500" },
});
