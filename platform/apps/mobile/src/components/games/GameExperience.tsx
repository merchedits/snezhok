import type { CooperativeActivity } from "@snezhok/contracts";
import { parseGameState, type GameState } from "@snezhok/game-engine";
import { memo, useMemo } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { materialAdvantage } from "../../domains/games/gamePresentation";
import { usePalette } from "../../hooks/usePalette";
import { useAppDialog } from "../AppDialogProvider";
import { Avatar } from "../Avatar";
import { CheckersBoard } from "./boards/CheckersBoard";
import { ChessBoard } from "./boards/ChessBoard";
import { PoolBoard } from "./boards/PoolBoard";
import { SeaBattleBoard } from "./boards/SeaBattleBoard";
import { TicTacToeBoard } from "./boards/TicTacToeBoard";

interface Props {
  activity: CooperativeActivity;
  meId: string | undefined;
  busy: boolean;
  language: "ru" | "en";
  run: (action: string, payload?: Record<string, unknown>) => Promise<boolean>;
}

export const GameExperience = memo(function GameExperience({ activity, meId, busy, language, run }: Props) {
  const palette = usePalette();
  const showDialog = useAppDialog();
  const state = useMemo(() => {
    try { return parseGameState(activity.result); } catch { return null; }
  }, [activity.result]);
  if (!state || !meId) return <Text style={[styles.error, { color: palette.danger }]}>{language === "ru" ? "Состояние партии повреждено. Попробуйте открыть её ещё раз." : "The game state is unavailable. Reopen the game and try again."}</Text>;
  const players = state.players.map((id) => activity.participants.find((participant) => participant.user.id === id)?.user).filter(Boolean) as CooperativeActivity["participants"][number]["user"][];
  const activePlayer = activity.participants.find((participant) => participant.user.id === state.turnUserId)?.user;
  const winner = activity.participants.find((participant) => participant.user.id === state.winnerId)?.user;
  const myRematch = state.rematchRequests.includes(meId);
  const otherRematch = state.rematchRequests.some((id) => id !== meId);
  const status = statusCopy(state, meId, activePlayer?.displayName, winner?.displayName, language);
  const material = state.kind === "chess" || state.kind === "checkers"
    ? [materialAdvantage(state, 0), materialAdvantage(state, 1)] as const
    : [0, 0] as const;
  const resign = () => showDialog(
    language === "ru" ? "Сдаться в этой партии?" : "Resign this game?",
    language === "ru" ? "Победа и очко достанутся второму игроку. Следом можно сразу начать реванш." : "The other player will win the round. You can start a rematch immediately afterward.",
    [
      { text: language === "ru" ? "Продолжить" : "Keep playing", style: "cancel" },
      { text: language === "ru" ? "Сдаться" : "Resign", style: "destructive", onPress: () => void run("game-resign") },
    ],
  );
  return (
    <View style={styles.root}>
      <View style={[styles.score, { backgroundColor: palette.surface }]}>
        <PlayerSummary player={players[0]} index={0} meId={meId} role={roleCopy(state, 0, language)} advantage={material[0]} language={language} />
        <View style={[styles.scorePill, { backgroundColor: palette.accentSoft }]}>
          <Text maxFontSizeMultiplier={1.1} style={[styles.scoreText, { color: palette.text }]}>{state.scores[state.players[0]] ?? 0} : {state.scores[state.players[1]] ?? 0}</Text>
          <Text maxFontSizeMultiplier={1.1} style={[styles.round, { color: palette.secondaryText }]}>{language === "ru" ? `партия ${state.round}` : `round ${state.round}`}</Text>
        </View>
        <PlayerSummary player={players[1]} index={1} meId={meId} role={roleCopy(state, 1, language)} advantage={material[1]} language={language} />
      </View>
      <Text maxFontSizeMultiplier={1.2} accessibilityLiveRegion="polite" style={[styles.status, { color: palette.text }]}>{status}</Text>
      {state.kind === "tic-tac-toe" ? <TicTacToeBoard state={state} meId={meId} busy={busy} run={run} /> : null}
      {state.kind === "chess" ? <ChessBoard state={state} meId={meId} busy={busy} run={run} language={language} /> : null}
      {state.kind === "checkers" ? <CheckersBoard state={state} meId={meId} busy={busy} run={run} /> : null}
      {state.kind === "sea-battle" ? <SeaBattleBoard state={state} privateState={activity.privateState} meId={meId} busy={busy} run={run} language={language} /> : null}
      {state.kind === "pool" ? <PoolBoard state={state} meId={meId} busy={busy} run={run} language={language} /> : null}
      {state.status === "completed" ? (
        <View style={styles.resultActions}>
          <Pressable accessibilityRole="button" disabled={busy || myRematch} onPress={() => void run("game-rematch")} style={({ pressed }) => [styles.primary, { backgroundColor: palette.pop, opacity: busy || myRematch ? 0.5 : pressed ? 0.82 : 1 }]}>
            {busy ? <ActivityIndicator color={palette.onPop} /> : <Text style={[styles.primaryText, { color: palette.onPop }]}>{myRematch ? (language === "ru" ? "Ждём второго игрока" : "Waiting for the other player") : otherRematch ? (language === "ru" ? "Принять реванш" : "Accept rematch") : (language === "ru" ? "Играть ещё" : "Play again")}</Text>}
          </Pressable>
        </View>
      ) : state.status === "playing" ? (
        <Pressable accessibilityRole="button" disabled={busy} onPress={resign} style={styles.resign}><Text style={[styles.resignText, { color: palette.danger }]}>{language === "ru" ? "Сдаться" : "Resign"}</Text></Pressable>
      ) : null}
    </View>
  );
});

function PlayerSummary({ player, index, meId, role, advantage, language }: {
  player: CooperativeActivity["participants"][number]["user"] | undefined;
  index: 0 | 1;
  meId: string;
  role: string;
  advantage: number;
  language: "ru" | "en";
}) {
  const palette = usePalette();
  if (!player) return <View style={styles.player} />;
  const right = index === 1;
  return <View style={[styles.player, right && styles.playerRight]}>
    <Avatar uri={player.avatarUrl} label={player.displayName} color={player.avatarColor} size={34} />
    <View style={[styles.playerCopy, right && styles.rightCopy]}>
      <Text maxFontSizeMultiplier={1.1} numberOfLines={1} style={[styles.playerName, right && styles.rightText, { color: palette.text }]}>{player.id === meId ? (language === "ru" ? "Вы" : "You") : player.displayName}</Text>
      <View style={[styles.roleLine, right && styles.roleLineRight]}>
        <Text maxFontSizeMultiplier={1.1} numberOfLines={1} style={[styles.playerRole, { color: palette.secondaryText }]}>{role}</Text>
        {advantage > 0 ? <Text allowFontScaling={false} style={[styles.advantage, { color: palette.success }]}>+{advantage}</Text> : null}
      </View>
    </View>
  </View>;
}

function statusCopy(state: GameState, meId: string, activeName: string | undefined, winnerName: string | undefined, language: "ru" | "en") {
  if (state.status === "setup") return language === "ru" ? "Подготовьте поле. Партия начнётся, когда оба будут готовы." : "Prepare the board. The round starts when both players are ready.";
  if (state.status === "completed") {
    if (!state.winnerId) return language === "ru" ? "Ничья — отличная причина сыграть ещё." : "A draw — a perfect reason to play again.";
    return state.winnerId === meId ? (language === "ru" ? "Вы выиграли эту партию" : "You won this round") : language === "ru" ? `${winnerName ?? "Соперник"} выигрывает эту партию` : `${winnerName ?? "The other player"} wins this round`;
  }
  return state.turnUserId === meId ? (language === "ru" ? "Ваш ход" : "Your turn") : language === "ru" ? `Ходит ${activeName ?? "второй игрок"}` : `${activeName ?? "The other player"}'s turn`;
}

function roleCopy(state: GameState, index: number, language: "ru" | "en") {
  if (state.kind === "tic-tac-toe") return index === 0 ? "X" : "O";
  if (state.kind === "chess") return index === 0 ? (language === "ru" ? "белые" : "white") : (language === "ru" ? "чёрные" : "black");
  if (state.kind === "checkers") return index === 0 ? (language === "ru" ? "светлые" : "light") : (language === "ru" ? "тёмные" : "dark");
  if (state.kind === "pool") return state.groups[state.players[index]!] ? (state.groups[state.players[index]!] === "solid" ? (language === "ru" ? "целые" : "solids") : (language === "ru" ? "полосатые" : "stripes")) : "—";
  return language === "ru" ? "флот" : "fleet";
}

const styles = StyleSheet.create({
  root: { gap: 12 }, error: { fontSize: 14, lineHeight: 20, fontWeight: "700", paddingVertical: 24 },
  score: { minHeight: 66, borderRadius: 18, padding: 9, flexDirection: "row", alignItems: "center", gap: 5 },
  player: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 6 }, playerRight: { flexDirection: "row-reverse" },
  playerCopy: { flex: 1, minWidth: 0 }, rightCopy: { alignItems: "flex-end" },
  playerName: { width: "100%", fontSize: 12, fontWeight: "800" }, rightText: { textAlign: "right" }, playerRole: { flexShrink: 1, fontSize: 10 },
  roleLine: { maxWidth: "100%", flexDirection: "row", alignItems: "center", gap: 4, marginTop: 1 }, roleLineRight: { flexDirection: "row-reverse" }, advantage: { fontSize: 10, fontWeight: "900" },
  scorePill: { width: 76, flexShrink: 0, minHeight: 48, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  scoreText: { fontSize: 18, fontWeight: "900" }, round: { fontSize: 9, fontWeight: "700", marginTop: 1 },
  status: { fontSize: 18, lineHeight: 23, fontWeight: "800", textAlign: "center" }, resultActions: { gap: 8 },
  primary: { minHeight: 52, borderRadius: 17, alignItems: "center", justifyContent: "center", paddingHorizontal: 16 }, primaryText: { fontSize: 16, fontWeight: "800" },
  resign: { minHeight: 44, alignItems: "center", justifyContent: "center" }, resignText: { fontSize: 13, fontWeight: "800" },
});
