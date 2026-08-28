import { chessPieces, legalChessMoves, type ChessState } from "@snezhok/game-engine";
import { memo, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";

// Filled silhouettes for both sides are easier to distinguish on compact
// Android screens than the outlined Unicode white-piece set.
const GLYPHS = { wk: "♚", wq: "♛", wr: "♜", wb: "♝", wn: "♞", wp: "♟", bk: "♚", bq: "♛", br: "♜", bb: "♝", bn: "♞", bp: "♟" } as const;

export const ChessBoard = memo(function ChessBoard({ state, meId, busy, run, language }: { state: ChessState; meId: string; busy: boolean; run: (action: string, payload?: Record<string, unknown>) => Promise<boolean>; language: "ru" | "en" }) {
  const { width } = useWindowDimensions();
  const size = Math.min(width - 36, 360);
  const [selected, setSelected] = useState<string | null>(null);
  const [promotion, setPromotion] = useState<{ from: string; to: string } | null>(null);
  const pieces = useMemo(() => chessPieces(state), [state]);
  const legal = useMemo(() => selected ? legalChessMoves(state, selected) : [], [selected, state]);
  const whitePerspective = state.players[0] === meId;
  const ownColor = whitePerspective ? "w" : "b";
  const squares = useMemo(() => boardSquares(whitePerspective), [whitePerspective]);
  const enabled = state.status === "playing" && state.turnUserId === meId && !busy;
  const press = async (square: string) => {
    const piece = pieces[square];
    if (!enabled) return;
    if (selected && legal.some((move) => move.to === square)) {
      const from = selected;
      setSelected(null);
      if (legal.some((move) => move.to === square && move.promotion)) {
        setPromotion({ from, to: square });
        return;
      }
      await run("game-move", { from, to: square });
      return;
    }
    setSelected(piece?.color === ownColor ? square : null);
  };
  const promote = async (piece: "q" | "r" | "b" | "n") => {
    if (!promotion) return;
    const move = promotion;
    setPromotion(null);
    await run("game-move", { ...move, promotion: piece });
  };
  return (
    <View style={styles.wrap}>
    <View style={[styles.board, { width: size, height: size }]}>
      {squares.map((square, index) => {
        const piece = pieces[square];
        const isLight = (Math.floor(index / 8) + index % 8) % 2 === 0;
        const target = legal.some((move) => move.to === square);
        return (
          <Pressable accessibilityRole="button" accessibilityLabel={`${square}${piece ? ` ${piece.color}${piece.type}` : ""}`} key={square} onPress={() => void press(square)} style={[styles.square, { backgroundColor: selected === square ? (isLight ? "#F5F682" : "#B9CA43") : isLight ? "#EEEED2" : "#769656" }]}>
            {target ? <View style={[styles.target, piece && styles.capture]} /> : null}
            {piece ? <Text allowFontScaling={false} style={[styles.piece, { fontSize: size / 9.8, lineHeight: size / 8 }, piece.color === "w" ? styles.whitePiece : styles.blackPiece]}>{GLYPHS[`${piece.color}${piece.type}` as keyof typeof GLYPHS]}</Text> : null}
          </Pressable>
        );
      })}
      <Text pointerEvents="none" style={styles.cornerLabel}>{state.inCheck ? (language === "ru" ? "ШАХ" : "CHECK") : ""}</Text>
    </View>
    {promotion ? <View style={styles.promotion}><Text style={styles.promotionLabel}>{language === "ru" ? "Превратить пешку в" : "Promote pawn to"}</Text>{(["q", "r", "b", "n"] as const).map((piece) => <Pressable accessibilityRole="button" key={piece} onPress={() => void promote(piece)} style={styles.promotionChoice}><Text style={styles.promotionPiece}>{GLYPHS[`${ownColor}${piece}` as keyof typeof GLYPHS]}</Text></Pressable>)}</View> : null}
    </View>
  );
});

function boardSquares(white: boolean) {
  const ranks = white ? [8, 7, 6, 5, 4, 3, 2, 1] : [1, 2, 3, 4, 5, 6, 7, 8];
  const files = white ? ["a", "b", "c", "d", "e", "f", "g", "h"] : ["h", "g", "f", "e", "d", "c", "b", "a"];
  return ranks.flatMap((rank) => files.map((file) => `${file}${rank}`));
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  board: { alignSelf: "center", flexDirection: "row", flexWrap: "wrap", borderRadius: 12, overflow: "hidden" },
  square: { width: "12.5%", height: "12.5%", alignItems: "center", justifyContent: "center" },
  piece: { zIndex: 2, textAlign: "center" }, whitePiece: { color: "#F8F8F8", textShadowColor: "#3A3A34", textShadowRadius: 1.2, textShadowOffset: { width: 0, height: 1 } }, blackPiece: { color: "#252421" },
  target: { position: "absolute", width: 13, height: 13, borderRadius: 8, backgroundColor: "rgba(40,40,32,0.3)" }, capture: { width: "84%", height: "84%", borderWidth: 4, borderColor: "rgba(246,246,105,0.86)", backgroundColor: "transparent" },
  cornerLabel: { position: "absolute", top: 7, right: 7, color: "#B5244C", backgroundColor: "#FFF7E8", borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2, fontSize: 10, fontWeight: "900" },
  promotion: { minHeight: 58, borderRadius: 15, backgroundColor: "#30264D", paddingHorizontal: 10, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  promotionLabel: { color: "#FFF7E8", fontSize: 11, fontWeight: "800", marginRight: 4 }, promotionChoice: { width: 42, height: 42, borderRadius: 12, backgroundColor: "#FFF7E8", alignItems: "center", justifyContent: "center" }, promotionPiece: { color: "#201927", fontSize: 29, lineHeight: 33 },
});
