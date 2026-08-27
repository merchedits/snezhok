import { tracePoolShot, type PoolBall, type PoolState } from "@snezhok/game-engine";
import { memo, useEffect, useRef, useState } from "react";
import { ActivityIndicator, GestureResponderEvent, Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import Svg, { Circle, Line, Rect, Text as SvgText } from "react-native-svg";
import { usePalette } from "../../../hooks/usePalette";

const BALL_COLORS: Record<number, string> = { 1: "#F5D04C", 2: "#3479D2", 3: "#D64C49", 4: "#8255B7", 5: "#EA812B", 6: "#3B9B69", 7: "#7C2830", 8: "#17131A", 9: "#F5D04C", 10: "#3479D2", 11: "#D64C49", 12: "#8255B7", 13: "#EA812B", 14: "#3B9B69", 15: "#7C2830" };

export const PoolBoard = memo(function PoolBoard({ state, meId, busy, run, language }: { state: PoolState; meId: string; busy: boolean; run: (action: string, payload?: Record<string, unknown>) => Promise<boolean>; language: "ru" | "en" }) {
  const palette = usePalette();
  const { width } = useWindowDimensions();
  const tableWidth = Math.min(width - 68, 344);
  const cue = state.balls.find((ball) => ball.id === 0)!;
  const ballInHand = state.ballInHandUserId === meId;
  const [angle, setAngle] = useState(0);
  const [power, setPower] = useState(0.58);
  const [placing, setPlacing] = useState(ballInHand);
  const [cuePosition, setCuePosition] = useState({ x: cue.x, y: cue.y });
  const [visualBalls, setVisualBalls] = useState<PoolBall[]>(state.balls);
  const [animating, setAnimating] = useState(false);
  const previousState = useRef(state);
  useEffect(() => { setCuePosition({ x: cue.x, y: cue.y }); setPlacing(ballInHand); }, [ballInHand, cue.x, cue.y, state.round]);
  useEffect(() => {
    const previous = previousState.current;
    previousState.current = state;
    if (!state.lastShot || previous.lastActionAt === state.lastActionAt) {
      setVisualBalls(state.balls);
      return;
    }
    const frames = tracePoolShot(previous.balls, state.lastShot.angle, state.lastShot.power,
      state.lastShot.cueX != null && state.lastShot.cueY != null ? { x: state.lastShot.cueX, y: state.lastShot.cueY } : undefined);
    if (frames.length < 2) {
      setVisualBalls(state.balls);
      return;
    }
    let frame = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setAnimating(true);
    const advance = () => {
      setVisualBalls(frames[frame] ?? state.balls);
      frame += 1;
      if (frame < frames.length) timer = setTimeout(advance, 16);
      else { setVisualBalls(state.balls); setAnimating(false); }
    };
    advance();
    return () => { if (timer) clearTimeout(timer); setAnimating(false); };
  }, [state.lastActionAt]);
  const canPlay = state.status === "playing" && state.turnUserId === meId && !busy && !animating;
  const activeCue = ballInHand ? cuePosition : cue;
  const tablePress = (event: GestureResponderEvent) => {
    if (!canPlay) return;
    const x = clamp(event.nativeEvent.locationX / tableWidth, 0.08, 0.92);
    const y = clamp(event.nativeEvent.locationY / (tableWidth / 2) * 0.5, 0.07, 0.43);
    if (placing) { setCuePosition({ x, y }); setPlacing(false); return; }
    setAngle(Math.atan2(y - activeCue.y, x - activeCue.x));
  };
  const shoot = () => void run("game-move", { angle, power, ...(ballInHand ? { cueX: cuePosition.x, cueY: cuePosition.y } : {}) });
  return (
    <View style={styles.root}>
      <Pressable accessibilityRole="adjustable" accessibilityLabel={language === "ru" ? "Бильярдный стол: нажмите, чтобы прицелиться" : "Pool table: tap to aim"} onPress={tablePress} style={[styles.tableWrap, { width: tableWidth }]}>
        <Svg width="100%" height="100%" viewBox="0 0 1000 500">
          <Rect x="0" y="0" width="1000" height="500" rx="48" fill="#18251E" />
          <Rect x="28" y="28" width="944" height="444" rx="30" fill="#277557" stroke="#A8814F" strokeWidth="25" />
          {[[28, 28], [500, 20], [972, 28], [28, 472], [500, 480], [972, 472]].map(([x, y], index) => <Circle key={index} cx={x} cy={y} r="28" fill="#0B0D0C" />)}
          {canPlay && !placing ? <Line x1={activeCue.x * 1000} y1={activeCue.y * 1000} x2={(activeCue.x + Math.cos(angle) * 0.32) * 1000} y2={(activeCue.y + Math.sin(angle) * 0.32) * 1000} stroke="#D7FF29" strokeWidth="6" strokeDasharray="16 12" /> : null}
          {visualBalls.filter((ball) => !ball.pocketed && ball.id !== 0).map((ball) => <PoolBallGlyph key={ball.id} id={ball.id} x={ball.x} y={ball.y} stripe={ball.kind === "stripe"} />)}
          {animating ? (() => { const visualCue = visualBalls.find((ball) => ball.id === 0); return visualCue && !visualCue.pocketed ? <PoolBallGlyph id={0} x={visualCue.x} y={visualCue.y} /> : null; })() : !cue.pocketed || ballInHand ? <PoolBallGlyph id={0} x={activeCue.x} y={activeCue.y} /> : null}
        </Svg>
        {busy ? <View pointerEvents="none" style={styles.busyOverlay}><ActivityIndicator color="#D7FF29" /><Text style={styles.busyText}>{language === "ru" ? "Рассчитываем удар" : "Resolving shot"}</Text></View> : null}
      </Pressable>
      <Text style={[styles.hint, { color: palette.secondaryText }]}>{placing ? (language === "ru" ? "Нажмите на свободное место, чтобы поставить биток" : "Tap an open spot to place the cue ball") : canPlay ? (language === "ru" ? "Нажмите на стол в направлении удара" : "Tap the table in the direction of your shot") : (language === "ru" ? "Следите за столом — позиция сохранится для следующего хода" : "The table position is saved for the next turn")}</Text>
      <View style={styles.controls}>
        {[0.3, 0.58, 0.88].map((value) => <Pressable accessibilityRole="button" accessibilityState={{ selected: power === value }} disabled={!canPlay} key={value} onPress={() => setPower(value)} style={[styles.power, { backgroundColor: power === value ? palette.accentSoft : palette.surface }]}><Text style={[styles.powerText, { color: palette.text }]}>{Math.round(value * 100)}%</Text></Pressable>)}
        {ballInHand && !placing ? <Pressable accessibilityRole="button" disabled={!canPlay} onPress={() => setPlacing(true)} style={[styles.moveCue, { borderColor: palette.border }]}><Text style={[styles.moveCueText, { color: palette.secondaryText }]}>{language === "ru" ? "Биток" : "Cue"}</Text></Pressable> : null}
      </View>
      <Pressable accessibilityRole="button" disabled={!canPlay || placing} onPress={shoot} style={({ pressed }) => [styles.shoot, { backgroundColor: palette.pop, opacity: !canPlay || placing ? 0.45 : pressed ? 0.82 : 1 }]}><Text style={[styles.shootText, { color: palette.onPop }]}>{language === "ru" ? "Удар" : "Shoot"}</Text></Pressable>
      {state.lastShot?.foul ? <Text style={[styles.foul, { color: palette.danger }]}>{language === "ru" ? "Фол · соперник ставит биток" : "Foul · ball in hand for the other player"}</Text> : null}
    </View>
  );
});

function PoolBallGlyph({ id, x, y, stripe = false }: { id: number; x: number; y: number; stripe?: boolean }) {
  const color = id === 0 ? "#FFFDF7" : BALL_COLORS[id] ?? "#17131A";
  return <>
    <Circle cx={x * 1000} cy={y * 1000} r="16" fill={stripe ? "#FFFDF7" : color} stroke="#17131A" strokeWidth="2" />
    {stripe ? <Rect x={x * 1000 - 15} y={y * 1000 - 7} width="30" height="14" rx="4" fill={color} /> : null}
    {id > 0 ? <Circle cx={x * 1000} cy={y * 1000} r="7" fill="#FFFDF7" /> : null}
    {id > 0 ? <SvgText x={x * 1000} y={y * 1000 + 3.3} fill="#17131A" fontSize="8" fontWeight="900" textAnchor="middle">{id}</SvgText> : null}
  </>;
}

function clamp(value: number, min: number, max: number) { return Math.max(min, Math.min(max, value)); }

const styles = StyleSheet.create({
  root: { gap: 10 }, tableWrap: { alignSelf: "center", aspectRatio: 2, borderRadius: 19, overflow: "hidden" }, busyOverlay: { position: "absolute", inset: 0, backgroundColor: "rgba(11,13,12,0.5)", alignItems: "center", justifyContent: "center", gap: 7 }, busyText: { color: "#FFFDF7", fontSize: 11, fontWeight: "800" }, hint: { fontSize: 11, lineHeight: 16, textAlign: "center" },
  controls: { flexDirection: "row", justifyContent: "center", gap: 7 }, power: { minWidth: 58, minHeight: 40, borderRadius: 13, alignItems: "center", justifyContent: "center" }, powerText: { fontSize: 12, fontWeight: "800" },
  moveCue: { minWidth: 58, minHeight: 40, borderRadius: 13, borderWidth: 1, alignItems: "center", justifyContent: "center" }, moveCueText: { fontSize: 11, fontWeight: "800" },
  shoot: { minHeight: 50, borderRadius: 16, alignItems: "center", justifyContent: "center" }, shootText: { fontSize: 16, fontWeight: "900" }, foul: { fontSize: 12, fontWeight: "800", textAlign: "center" },
});
