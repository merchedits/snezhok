import { legalCheckersMoves, type CheckersState } from "@snezhok/game-engine";
import { memo, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";

export const CheckersBoard = memo(function CheckersBoard({ state, meId, busy, run }: { state: CheckersState; meId: string; busy: boolean; run: (action: string, payload?: Record<string, unknown>) => Promise<boolean> }) {
  const { width } = useWindowDimensions();
  const size = Math.min(width - 68, 344);
  const [selected, setSelected] = useState<number | null>(state.forcedFrom);
  const legal = useMemo(() => legalCheckersMoves(state, meId), [state, meId]);
  const whitePerspective = state.players[0] === meId;
  const ownSide = whitePerspective ? "w" : "b";
  const indexes = useMemo(() => boardIndexes(whitePerspective), [whitePerspective]);
  const enabled = state.status === "playing" && state.turnUserId === meId && !busy;
  const current = state.forcedFrom ?? selected;
  const press = async (index: number) => {
    if (!enabled) return;
    const piece = state.board[index];
    if (current !== null && legal.some((move) => move.from === current && move.to === index)) {
      setSelected(null);
      await run("game-move", { from: current, to: index });
      return;
    }
    setSelected(piece?.toLowerCase() === ownSide && legal.some((move) => move.from === index) ? index : null);
  };
  return (
    <View style={[styles.board, { width: size, height: size }]}>
      {indexes.map((index, visualIndex) => {
        const piece = state.board[index];
        const target = current !== null && legal.some((move) => move.from === current && move.to === index);
        const playable = (Math.floor(index / 8) + index % 8) % 2 === 1;
        return (
          <Pressable accessibilityRole="button" accessibilityLabel={`${Math.floor(index / 8) + 1}, ${index % 8 + 1}`} key={`${index}-${visualIndex}`} onPress={() => void press(index)} style={[styles.square, { backgroundColor: current === index ? "#D7FF29" : playable ? "#72569B" : "#EEE5D3" }]}>
            {target ? <View style={styles.target} /> : null}
            {piece ? <View style={[styles.checker, piece.toLowerCase() === "w" ? styles.light : styles.dark]}>{piece === piece.toUpperCase() ? <Text style={styles.crown}>♛</Text> : null}</View> : null}
          </Pressable>
        );
      })}
    </View>
  );
});

function boardIndexes(white: boolean) {
  const indexes = Array.from({ length: 64 }, (_, index) => index);
  return white ? indexes : indexes.reverse();
}

const styles = StyleSheet.create({
  board: { alignSelf: "center", flexDirection: "row", flexWrap: "wrap", borderRadius: 17, overflow: "hidden" },
  square: { width: "12.5%", height: "12.5%", alignItems: "center", justifyContent: "center" },
  checker: { width: "76%", height: "76%", borderRadius: 999, alignItems: "center", justifyContent: "center", borderWidth: 2 },
  light: { backgroundColor: "#FFF7E8", borderColor: "#C9BFAF" }, dark: { backgroundColor: "#24202A", borderColor: "#0F0D12" },
  crown: { color: "#FFB72C", fontSize: 18, lineHeight: 20 }, target: { width: 13, height: 13, borderRadius: 8, backgroundColor: "rgba(215,255,41,0.8)" },
});
