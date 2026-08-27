import type { CooperativeActivity } from "@snezhok/contracts";
import { parseGameState, type GameState } from "@snezhok/game-engine";
import { memo, useMemo } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
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
        {players.map((player, index) => (
          <View key={player.id} style={[styles.player, index === 1 && styles.playerRight]}>
            <Avatar uri={player.avatarUrl} label={player.displayName} color={player.avatarColor} size={34} />
            <View style={index === 1 ? styles.rightCopy : undefined}>
              <Text numberOfLines={1} style={[styles.playerName, { color: palette.text }]}>{player.id === meId ? (language === "ru" ? "Вы" : "You") : player.displayName}</Text>
              <Text style={[styles.playerRole, { color: palette.secondaryText }]}>{roleCopy(state, index, language)}</Text>
            </View>
          </View>
        ))}
        <View style={[styles.scorePill, { backgroundColor: palette.accentSoft }]}>
          <Text style={[styles.scoreText, { color: palette.text }]}>{state.scores[state.players[0]] ?? 0} : {state.scores[state.players[1]] ?? 0}</Text>
          <Text style={[styles.round, { color: palette.secondaryText }]}>{language === "ru" ? `партия ${state.round}` : `round ${state.round}`}</Text>
        </View>
      </View>
      <Text accessibilityLiveRegion="polite" style={[styles.status, { color: palette.text }]}>{status}</Text>
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
          <Text style={[styles.rematchHint, { color: palette.secondaryText }]}>{language === "ru" ? "Новая партия начнётся здесь же, когда оба будут готовы." : "The next round starts here as soon as both players are ready."}</Text>
        </View>
      ) : state.status === "playing" ? (
        <Pressable accessibilityRole="button" disabled={busy} onPress={resign} style={styles.resign}><Text style={[styles.resignText, { color: palette.danger }]}>{language === "ru" ? "Сдаться" : "Resign"}</Text></Pressable>
      ) : null}
    </View>
  );
});

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
  if (state.kind === "pool") return state.groups[state.players[index]!] ? (state.groups[state.players[index]!] === "solid" ? (language === "ru" ? "целые" : "solids") : (language === "ru" ? "полосатые" : "stripes")) : (language === "ru" ? "группа не выбрана" : "open table");
  return language === "ru" ? "флот" : "fleet";
}

const styles = StyleSheet.create({
  root: { gap: 12 }, error: { fontSize: 14, lineHeight: 20, fontWeight: "700", paddingVertical: 24 },
  score: { minHeight: 66, borderRadius: 18, padding: 10, flexDirection: "row", alignItems: "center" },
  player: { width: "38%", flexDirection: "row", alignItems: "center", gap: 8 }, playerRight: { flexDirection: "row-reverse" }, rightCopy: { alignItems: "flex-end" },
  playerName: { fontSize: 12, fontWeight: "800", maxWidth: 80 }, playerRole: { fontSize: 10, marginTop: 1 },
  scorePill: { position: "absolute", left: "38%", width: "24%", minHeight: 48, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  scoreText: { fontSize: 18, fontWeight: "900" }, round: { fontSize: 9, fontWeight: "700", marginTop: 1 },
  status: { fontSize: 18, lineHeight: 23, fontWeight: "800", textAlign: "center" }, resultActions: { gap: 8 },
  primary: { minHeight: 52, borderRadius: 17, alignItems: "center", justifyContent: "center", paddingHorizontal: 16 }, primaryText: { fontSize: 16, fontWeight: "800" },
  rematchHint: { fontSize: 11, lineHeight: 16, textAlign: "center" }, resign: { minHeight: 44, alignItems: "center", justifyContent: "center" }, resignText: { fontSize: 13, fontWeight: "800" },
});
