import { POOL_GEOMETRY, tracePoolShot, type PoolBall, type PoolLastShot, type PoolState } from "@snezhok/game-engine";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { type GestureResponderEvent, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import Svg, { Circle, Line, Rect, Text as SvgText } from "react-native-svg";

import { poolShotFromPull } from "../../../domains/games/gamePresentation";
import { usePalette } from "../../../hooks/usePalette";

const BALL_COLORS: Record<number, string> = { 1: "#F5D04C", 2: "#3479D2", 3: "#D64C49", 4: "#8255B7", 5: "#EA812B", 6: "#3B9B69", 7: "#7C2830", 8: "#17131A", 9: "#F5D04C", 10: "#3479D2", 11: "#D64C49", 12: "#8255B7", 13: "#EA812B", 14: "#3B9B69", 15: "#7C2830" };
const POCKETS = POOL_GEOMETRY.pockets;

export const PoolBoard = memo(function PoolBoard({ state, meId, busy, run, language }: { state: PoolState; meId: string; busy: boolean; run: (action: string, payload?: Record<string, unknown>) => Promise<boolean>; language: "ru" | "en" }) {
  const palette = usePalette();
  const { width } = useWindowDimensions();
  const tableWidth = Math.min(Math.max(244, width - 68), 360);
  const cue = state.balls.find((ball) => ball.id === 0)!;
  const ballInHand = state.ballInHandUserId === meId;
  const [placing, setPlacing] = useState(ballInHand);
  const [cuePosition, setCuePosition] = useState({ x: cue.x, y: cue.y });
  const [pull, setPull] = useState<{ x: number; y: number } | null>(null);
  const [visualBalls, setVisualBalls] = useState<PoolBall[]>(state.balls);
  const [animating, setAnimating] = useState(false);
  const [pocketBurst, setPocketBurst] = useState<{ x: number; y: number; key: number } | null>(null);
  const previousState = useRef(state);
  const animationFrame = useRef<number | null>(null);
  const pendingLocalShot = useRef<PoolLastShot | null>(null);

  useEffect(() => {
    setCuePosition({ x: cue.x, y: cue.y });
    setPlacing(ballInHand);
    setPull(null);
  }, [ballInHand, cue.x, cue.y, state.round]);

  useEffect(() => {
    const previous = previousState.current;
    previousState.current = state;
    if (!state.lastShot || previous.lastActionAt === state.lastActionAt) {
      if (!animating) setVisualBalls(state.balls);
      return;
    }
    const local = pendingLocalShot.current;
    const isLocalEcho = local && sameShot(local, state.lastShot);
    pendingLocalShot.current = null;
    if (isLocalEcho) return;
    playShot(previous.balls, state.lastShot, state.balls);
  }, [state.lastActionAt]);

  useEffect(() => () => {
    if (animationFrame.current !== null) cancelAnimationFrame(animationFrame.current);
  }, []);

  const canPlay = state.status === "playing" && state.turnUserId === meId && !busy && !animating;
  const activeCue = ballInHand ? cuePosition : cue;
  const gesture = useMemo(() => pull ? poolShotFromPull(activeCue, pull) : null, [activeCue, pull]);
  const point = (event: GestureResponderEvent) => ({
    x: clamp(event.nativeEvent.locationX / tableWidth, POOL_GEOMETRY.minX + POOL_GEOMETRY.ballRadius, POOL_GEOMETRY.maxX - POOL_GEOMETRY.ballRadius),
    y: clamp(event.nativeEvent.locationY / tableWidth, POOL_GEOMETRY.minY + POOL_GEOMETRY.ballRadius, POOL_GEOMETRY.maxY - POOL_GEOMETRY.ballRadius),
  });
  const nearCue = (event: GestureResponderEvent) => {
    if (!canPlay) return false;
    const next = point(event);
    return placing || Math.hypot(next.x - activeCue.x, next.y - activeCue.y) <= 0.07;
  };
  const startGesture = (event: GestureResponderEvent) => {
    const next = point(event);
    if (placing) setCuePosition(next);
    else setPull(next);
  };
  const moveGesture = (event: GestureResponderEvent) => {
    const next = point(event);
    if (placing) setCuePosition(next);
    else setPull(next);
  };
  const finishGesture = () => {
    if (placing) {
      setPlacing(false);
      return;
    }
    if (!gesture) {
      setPull(null);
      return;
    }
    const shot: PoolLastShot = { shooterId: meId, angle: gesture.angle, power: gesture.power, pocketed: [], foul: false, ...(ballInHand ? { cueX: cuePosition.x, cueY: cuePosition.y } : {}) };
    pendingLocalShot.current = shot;
    setPull(null);
    const frames = tracePoolShot(state.balls, shot.angle, shot.power, ballInHand ? cuePosition : undefined);
    const finalBalls = frames.at(-1) ?? state.balls;
    const newlyPocketed = finalBalls.filter((ball) => ball.pocketed && !state.balls.find((before) => before.id === ball.id)?.pocketed).map((ball) => ball.id);
    playFrames(frames, finalBalls, newlyPocketed);
    void run("game-move", { angle: shot.angle, power: shot.power, ...(ballInHand ? { cueX: cuePosition.x, cueY: cuePosition.y } : {}) }).then((ok) => {
      if (!ok) {
        pendingLocalShot.current = null;
        stopAnimation(state.balls);
      }
    });
  };

  const playShot = (balls: PoolBall[], shot: PoolLastShot, finalBalls: PoolBall[]) => {
    const frames = tracePoolShot(balls, shot.angle, shot.power, shot.cueX != null && shot.cueY != null ? { x: shot.cueX, y: shot.cueY } : undefined);
    playFrames(frames, finalBalls, shot.pocketed);
  };
  const playFrames = (frames: PoolBall[][], finalBalls: PoolBall[], pocketed: number[]) => {
    if (frames.length < 2) {
      setVisualBalls(finalBalls);
      return;
    }
    if (animationFrame.current !== null) cancelAnimationFrame(animationFrame.current);
    setAnimating(true);
    const duration = Math.min(3200, Math.max(900, frames.length * 10));
    const started = performance.now();
    let announcedPocket = false;
    const step = (now: number) => {
      const progress = Math.min(1, (now - started) / duration);
      const index = Math.min(frames.length - 1, Math.floor(progress * frames.length));
      setVisualBalls(frames[index] ?? finalBalls);
      if (!announcedPocket && pocketed.length > 0 && progress > 0.68) {
        announcedPocket = true;
        const ball = frames[Math.max(0, index - 1)]?.find((item) => item.id === pocketed[0]);
        const pocket = ball ? nearestPocket(ball) : POCKETS[0];
        setPocketBurst({ x: pocket[0], y: pocket[1], key: Date.now() });
        setTimeout(() => setPocketBurst(null), 420);
      }
      if (progress < 1) animationFrame.current = requestAnimationFrame(step);
      else stopAnimation(finalBalls);
    };
    animationFrame.current = requestAnimationFrame(step);
  };
  const stopAnimation = (balls: PoolBall[]) => {
    if (animationFrame.current !== null) cancelAnimationFrame(animationFrame.current);
    animationFrame.current = null;
    setVisualBalls(balls);
    setAnimating(false);
  };

  const aimLength = gesture ? 0.2 + gesture.power * 0.22 : 0;
  return <View style={styles.root}>
    <View
      accessibilityRole="adjustable"
      accessibilityLabel={language === "ru" ? "Бильярдный стол. Потяните биток назад и отпустите" : "Pool table. Pull the cue ball back and release"}
      onStartShouldSetResponder={nearCue}
      onMoveShouldSetResponder={nearCue}
      onResponderGrant={startGesture}
      onResponderMove={moveGesture}
      onResponderRelease={finishGesture}
      onResponderTerminate={() => setPull(null)}
      style={[styles.tableWrap, { width: tableWidth, height: tableWidth / 2 }]}
    >
      <Svg width="100%" height="100%" viewBox="0 0 1000 500">
        <Rect x="0" y="0" width="1000" height="500" rx="42" fill="#4A2815" />
        <Rect x="28" y="28" width="944" height="444" rx="30" fill="#855229" />
        <Rect x="55" y="55" width="890" height="390" rx="18" fill="#257A55" stroke="#173F31" strokeWidth="4" />
        {POCKETS.map(([x, y], index) => <Circle key={index} cx={x * 1000} cy={y * 1000} r={POOL_GEOMETRY.pocketRadius * 1000} fill="#090B0A" stroke="#5B341C" strokeWidth="8" />)}
        {gesture ? <>
          <Line x1={activeCue.x * 1000} y1={activeCue.y * 1000} x2={(activeCue.x + Math.cos(gesture.angle) * aimLength) * 1000} y2={(activeCue.y + Math.sin(gesture.angle) * aimLength) * 1000} stroke="#FFF9DB" strokeWidth="5" strokeDasharray="16 12" strokeLinecap="round" />
          <Line x1={activeCue.x * 1000} y1={activeCue.y * 1000} x2={(pull?.x ?? activeCue.x) * 1000} y2={(pull?.y ?? activeCue.y) * 1000} stroke="#D7FF29" strokeWidth="9" strokeLinecap="round" opacity={0.78} />
        </> : null}
        {visualBalls.filter((ball) => !ball.pocketed && ball.id !== 0).map((ball) => <PoolBallGlyph key={ball.id} ball={ball} />)}
        {(() => { const visualCue = animating ? visualBalls.find((ball) => ball.id === 0) : activeCue; return visualCue && !("pocketed" in visualCue && visualCue.pocketed) ? <PoolBallGlyph ball={{ id: 0, kind: "cue", x: visualCue.x, y: visualCue.y, pocketed: false }} /> : null; })()}
        {pocketBurst ? <><Circle key={pocketBurst.key} cx={pocketBurst.x * 1000} cy={pocketBurst.y * 1000} r="48" fill="none" stroke="#D7FF29" strokeWidth="8" opacity="0.9" /><Circle cx={pocketBurst.x * 1000} cy={pocketBurst.y * 1000} r="62" fill="none" stroke="#FFF9DB" strokeWidth="4" opacity="0.55" /></> : null}
      </Svg>
    </View>
    {canPlay ? <Text maxFontSizeMultiplier={1.2} style={[styles.hint, { color: palette.secondaryText }]}>{placing ? (language === "ru" ? "Перетащите биток на свободное место" : "Drag the cue ball to an open spot") : (language === "ru" ? "Потяните биток назад и отпустите" : "Pull the cue ball back and release")}</Text> : null}
    {state.lastShot?.foul ? <Text maxFontSizeMultiplier={1.2} style={[styles.foul, { color: palette.danger }]}>{language === "ru" ? "Фол · соперник ставит биток" : "Foul · ball in hand for the other player"}</Text> : null}
  </View>;
});

function PoolBallGlyph({ ball }: { ball: PoolBall }) {
  const color = ball.id === 0 ? "#FFFDF7" : BALL_COLORS[ball.id] ?? "#17131A";
  const x = clamp(ball.x, POOL_GEOMETRY.minX, POOL_GEOMETRY.maxX) * 1000;
  const y = clamp(ball.y, POOL_GEOMETRY.minY, POOL_GEOMETRY.maxY) * 1000;
  const radius = POOL_GEOMETRY.ballRadius * 1000;
  return <>
    <Circle cx={x} cy={y} r={radius} fill={ball.kind === "stripe" ? "#FFFDF7" : color} stroke="#17131A" strokeWidth="2" />
    {ball.kind === "stripe" ? <Rect x={x - radius + 1} y={y - 7} width={(radius - 1) * 2} height="14" rx="4" fill={color} /> : null}
    {ball.id > 0 ? <Circle cx={x} cy={y} r="7" fill="#FFFDF7" /> : null}
    {ball.id > 0 ? <SvgText x={x} y={y + 3.3} fill="#17131A" fontSize="8" fontWeight="900" textAnchor="middle">{ball.id}</SvgText> : null}
    <Circle cx={x - radius * 0.32} cy={y - radius * 0.32} r={radius * 0.2} fill="rgba(255,255,255,0.48)" />
  </>;
}

function nearestPocket(ball: Pick<PoolBall, "x" | "y">) {
  return POCKETS.reduce((nearest, pocket) => Math.hypot(ball.x - pocket[0], ball.y - pocket[1]) < Math.hypot(ball.x - nearest[0], ball.y - nearest[1]) ? pocket : nearest);
}
function sameShot(first: PoolLastShot, second: PoolLastShot) { return Math.abs(first.angle - second.angle) < 0.0001 && Math.abs(first.power - second.power) < 0.0001 && first.shooterId === second.shooterId; }
function clamp(value: number, min: number, max: number) { return Math.max(min, Math.min(max, value)); }

const styles = StyleSheet.create({
  root: { gap: 10 },
  tableWrap: { alignSelf: "center", borderRadius: 17, overflow: "hidden", backgroundColor: "#4A2815" },
  hint: { minHeight: 18, paddingHorizontal: 8, fontSize: 12, lineHeight: 17, fontWeight: "700", textAlign: "center" },
  foul: { fontSize: 12, lineHeight: 17, fontWeight: "800", textAlign: "center" },
});
