import type { CooperativeActivity } from "@snezhok/contracts";
import { parseGameState } from "@snezhok/game-engine";
import { memo } from "react";
import { StyleSheet, Text, View } from "react-native";

export const GameActivityCardPreview = memo(function GameActivityCardPreview({ activity, ink, language }: { activity: CooperativeActivity; ink: string; language: "ru" | "en" }) {
  let state;
  try { state = parseGameState(activity.result); } catch { return null; }
  const first = activity.participants.find((participant) => participant.user.id === state.players[0])?.user;
  const second = activity.participants.find((participant) => participant.user.id === state.players[1])?.user;
  const winner = activity.participants.find((participant) => participant.user.id === state.winnerId)?.user;
  return (
    <View style={styles.root}>
      <View style={styles.scoreLine}>
        <Text numberOfLines={1} style={[styles.name, { color: ink }]}>{first?.displayName ?? "—"}</Text>
        <View style={styles.score}><Text style={[styles.scoreText, { color: ink }]}>{state.scores[state.players[0]] ?? 0} : {state.scores[state.players[1]] ?? 0}</Text></View>
        <Text numberOfLines={1} style={[styles.name, styles.rightName, { color: ink }]}>{second?.displayName ?? "—"}</Text>
      </View>
      <Text style={[styles.caption, { color: ink }]}>{state.status === "completed" ? (state.winnerId ? (language === "ru" ? `Победа: ${winner?.displayName ?? "игрок"}` : `Winner: ${winner?.displayName ?? "player"}`) : (language === "ru" ? "Ничья" : "Draw")) : state.status === "setup" ? (language === "ru" ? "Подготовка поля" : "Setting up") : (language === "ru" ? `Партия ${state.round} продолжается` : `Round ${state.round} in progress`)}</Text>
    </View>
  );
});

const styles = StyleSheet.create({
  root: { marginTop: 10, backgroundColor: "rgba(255,255,255,0.35)", borderRadius: 15, padding: 11, gap: 6 },
  scoreLine: { flexDirection: "row", alignItems: "center" }, name: { flex: 1, fontSize: 12, fontWeight: "800" }, rightName: { textAlign: "right" },
  score: { minWidth: 58, alignItems: "center" }, scoreText: { fontSize: 20, fontWeight: "900" }, caption: { fontSize: 11, fontWeight: "700", textAlign: "center", opacity: 0.78 },
});
