import { POOL_GEOMETRY, tracePoolShot, type PoolBall, type PoolLastShot, type PoolState } from "@snezhok/game-engine";
import { Canvas, Circle as SkiaCircle, Group, Rect as SkiaRect, select, Text as SkiaText, useFont, type SkFont } from "@shopify/react-native-skia";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type GestureResponderEvent, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { cancelAnimation, Easing, runOnJS, useDerivedValue, useSharedValue, withTiming, type SharedValue } from "react-native-reanimated";
import Svg, { Circle as SvgCircle, Line as SvgLine, Rect as SvgRect, Text as SvgText } from "react-native-svg";

import { poolPlaybackDuration, poolPullPoint, poolShotFromPull } from "../../../domains/games/gamePresentation";
import { usePalette } from "../../../hooks/usePalette";

const BALL_COLORS: Record<number, string> = { 1: "#F5D04C", 2: "#3479D2", 3: "#D64C49", 4: "#8255B7", 5: "#EA812B", 6: "#3B9B69", 7: "#7C2830", 8: "#17131A", 9: "#F5D04C", 10: "#3479D2", 11: "#D64C49", 12: "#8255B7", 13: "#EA812B", 14: "#3B9B69", 15: "#7C2830" };
const POCKETS = POOL_GEOMETRY.pockets;

interface PoolPlayback {
  key: number;
  frames: PoolBall[][];
  finalBalls: PoolBall[];
  pocketed: number[];
  duration: number;
}

interface PoolBallTrack {
  ball: PoolBall;
  x: number[];
  y: number[];
  opacity: number[];
}

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
  const [playback, setPlayback] = useState<PoolPlayback | null>(null);
  const [pocketBurst, setPocketBurst] = useState<{ x: number; y: number; key: number } | null>(null);
  const previousState = useRef(state);
  const animationProgress = useSharedValue(0);
  const ballFont = useFont(require("@expo-google-fonts/onest/900Black/Onest_900Black.ttf"), Math.max(5, tableWidth * 0.016));
  const playbackRef = useRef<PoolPlayback | null>(null);
  const pocketTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const playbackKey = useRef(0);
  const gestureOrigin = useRef<{ x: number; y: number; pageX: number; pageY: number } | null>(null);
  const pendingLocalShot = useRef<PoolLastShot | null>(null);
  const playbackTracks = useMemo(() => playback ? buildPoolTracks(playback.frames) : [], [playback]);

  useEffect(() => {
    setCuePosition({ x: cue.x, y: cue.y });
    setPlacing(ballInHand);
    setPull(null);
  }, [ballInHand, cue.x, cue.y, state.round]);

  useEffect(() => {
    const previous = previousState.current;
    previousState.current = state;
    if (!state.lastShot || previous.lastActionAt === state.lastActionAt) {
      if (!playback) setVisualBalls(state.balls);
      return;
    }
    const local = pendingLocalShot.current;
    const isLocalEcho = local && sameShot(local, state.lastShot);
    pendingLocalShot.current = null;
    if (isLocalEcho) return;
    playShot(previous.balls, state.lastShot, state.balls);
  }, [state.lastActionAt]);

  useEffect(() => () => {
    cancelAnimation(animationProgress);
    if (pocketTimer.current !== null) clearTimeout(pocketTimer.current);
  }, [animationProgress]);

  const canPlay = state.status === "playing" && state.turnUserId === meId && !busy && !playback;
  const activeCue = ballInHand ? cuePosition : cue;
  const gesture = useMemo(() => pull ? poolShotFromPull(activeCue, pull) : null, [activeCue, pull]);
  const rawPoint = (event: GestureResponderEvent) => ({
    x: event.nativeEvent.locationX / tableWidth,
    y: event.nativeEvent.locationY / tableWidth,
  });
  const boundedPoint = (event: GestureResponderEvent) => ({
    x: clamp(event.nativeEvent.locationX / tableWidth, POOL_GEOMETRY.minX + POOL_GEOMETRY.ballRadius, POOL_GEOMETRY.maxX - POOL_GEOMETRY.ballRadius),
    y: clamp(event.nativeEvent.locationY / tableWidth, POOL_GEOMETRY.minY + POOL_GEOMETRY.ballRadius, POOL_GEOMETRY.maxY - POOL_GEOMETRY.ballRadius),
  });
  const nearCue = (event: GestureResponderEvent) => {
    if (!canPlay) return false;
    const next = rawPoint(event);
    return placing || Math.hypot(next.x - activeCue.x, next.y - activeCue.y) <= 0.07;
  };
  const startGesture = (event: GestureResponderEvent) => {
    if (placing) {
      gestureOrigin.current = null;
      setCuePosition(boundedPoint(event));
      return;
    }
    const next = rawPoint(event);
    gestureOrigin.current = { ...next, pageX: event.nativeEvent.pageX, pageY: event.nativeEvent.pageY };
    setPull(next);
  };
  const moveGesture = (event: GestureResponderEvent) => {
    if (placing) {
      setCuePosition(boundedPoint(event));
      return;
    }
    const origin = gestureOrigin.current;
    if (!origin) return;
    setPull(poolPullPoint(origin, event.nativeEvent.pageX - origin.pageX, event.nativeEvent.pageY - origin.pageY, tableWidth));
  };
  const finishGesture = () => {
    gestureOrigin.current = null;
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
    cancelAnimation(animationProgress);
    if (pocketTimer.current !== null) clearTimeout(pocketTimer.current);
    animationProgress.value = 0;
    setPocketBurst(null);
    playbackKey.current += 1;
    const next = { key: playbackKey.current, frames, finalBalls, pocketed, duration: poolPlaybackDuration(frames.length) };
    playbackRef.current = next;
    setPlayback(next);
  };
  const stopAnimation = (balls: PoolBall[]) => {
    cancelAnimation(animationProgress);
    animationProgress.value = 0;
    if (pocketTimer.current !== null) clearTimeout(pocketTimer.current);
    pocketTimer.current = null;
    playbackRef.current = null;
    setPocketBurst(null);
    setPlayback(null);
    setVisualBalls(balls);
  };

  const completePlayback = useCallback((key: number) => {
    const current = playbackRef.current;
    if (!current || current.key !== key) return;
    playbackRef.current = null;
    setVisualBalls(current.finalBalls);
    setPlayback(null);
  }, []);

  useEffect(() => {
    if (!playback) return;
    const pocketEvent = firstPocketEvent(playback.frames, playback.pocketed, playback.duration);
    if (pocketEvent) {
      pocketTimer.current = setTimeout(() => {
        setPocketBurst({ x: pocketEvent.pocket[0], y: pocketEvent.pocket[1], key: playback.key });
        pocketTimer.current = setTimeout(() => {
          setPocketBurst(null);
          pocketTimer.current = null;
        }, 420);
      }, pocketEvent.delay);
    }
    animationProgress.value = 0;
    animationProgress.value = withTiming(1, {
      duration: Math.max(1, playback.duration),
      easing: Easing.linear,
    }, (finished) => {
      if (finished) runOnJS(completePlayback)(playback.key);
    });
    return () => {
      cancelAnimation(animationProgress);
      if (pocketTimer.current !== null) clearTimeout(pocketTimer.current);
      pocketTimer.current = null;
    };
  }, [animationProgress, completePlayback, playback]);

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
      onResponderTerminationRequest={() => false}
      onResponderTerminate={() => {
        gestureOrigin.current = null;
        setPull(null);
      }}
      style={[styles.tableWrap, { width: tableWidth, height: tableWidth / 2 }]}
    >
      <Svg width="100%" height="100%" viewBox="0 0 1000 500">
        <SvgRect x="0" y="0" width="1000" height="500" rx="42" fill="#4A2815" />
        <SvgRect x="28" y="28" width="944" height="444" rx="30" fill="#855229" />
        <SvgRect x="55" y="55" width="890" height="390" rx="18" fill="#257A55" stroke="#173F31" strokeWidth="4" />
        {POCKETS.map(([x, y], index) => <SvgCircle key={index} cx={x * 1000} cy={y * 1000} r={POOL_GEOMETRY.pocketRadius * 1000} fill="#090B0A" stroke="#5B341C" strokeWidth="8" />)}
        {gesture ? <>
          <SvgLine x1={activeCue.x * 1000} y1={activeCue.y * 1000} x2={(activeCue.x + Math.cos(gesture.angle) * aimLength) * 1000} y2={(activeCue.y + Math.sin(gesture.angle) * aimLength) * 1000} stroke="#FFF9DB" strokeWidth="5" strokeDasharray="16 12" strokeLinecap="round" />
          <SvgLine x1={activeCue.x * 1000} y1={activeCue.y * 1000} x2={(pull?.x ?? activeCue.x) * 1000} y2={(pull?.y ?? activeCue.y) * 1000} stroke="#D7FF29" strokeWidth="9" strokeLinecap="round" opacity={0.78} />
        </> : null}
        {!playback ? visualBalls.filter((ball) => !ball.pocketed && ball.id !== 0).map((ball) => <PoolBallGlyph key={ball.id} ball={ball} />) : null}
        {!playback && (ballInHand || !cue.pocketed) ? <PoolBallGlyph ball={{ id: 0, kind: "cue", x: activeCue.x, y: activeCue.y, pocketed: false }} /> : null}
        {pocketBurst ? <><SvgCircle key={pocketBurst.key} cx={pocketBurst.x * 1000} cy={pocketBurst.y * 1000} r="48" fill="none" stroke="#D7FF29" strokeWidth="8" opacity="0.9" /><SvgCircle cx={pocketBurst.x * 1000} cy={pocketBurst.y * 1000} r="62" fill="none" stroke="#FFF9DB" strokeWidth="4" opacity="0.55" /></> : null}
      </Svg>
      <Canvas androidWarmup pointerEvents="none" style={StyleSheet.absoluteFill}>
        {playbackTracks.map((track) => <AnimatedSkiaPoolBall key={track.ball.id} track={track} progress={animationProgress} tableWidth={tableWidth} font={ballFont} />)}
      </Canvas>
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
    <SvgCircle cx={x} cy={y} r={radius} fill={ball.kind === "stripe" ? "#FFFDF7" : color} stroke="#17131A" strokeWidth="2" />
    {ball.kind === "stripe" ? <SvgRect x={x - radius + 1} y={y - 7} width={(radius - 1) * 2} height="14" rx="4" fill={color} /> : null}
    {ball.id > 0 ? <SvgCircle cx={x} cy={y} r="7" fill="#FFFDF7" /> : null}
    {ball.id > 0 ? <SvgText x={x} y={y + 3.3} fill="#17131A" fontSize="8" fontWeight="900" textAnchor="middle">{ball.id}</SvgText> : null}
    <SvgCircle cx={x - radius * 0.32} cy={y - radius * 0.32} r={radius * 0.2} fill="rgba(255,255,255,0.48)" />
  </>;
}

function AnimatedSkiaPoolBall({ track, progress, tableWidth, font }: { track: PoolBallTrack; progress: SharedValue<number>; tableWidth: number; font: SkFont | null }) {
  const radius = POOL_GEOMETRY.ballRadius * tableWidth;
  const color = track.ball.id === 0 ? "#FFFDF7" : BALL_COLORS[track.ball.id] ?? "#17131A";
  const label = String(track.ball.id);
  const labelBounds = font?.measureText(label);
  const labelWidth = labelBounds?.width ?? 0;
  const metrics = font?.getMetrics();
  const labelBaselineOffset = metrics ? -(metrics.ascent + metrics.descent) / 2 : 0;
  const sample = useDerivedValue(() => {
    const last = track.x.length - 1;
    const exact = Math.max(0, Math.min(last, progress.value * last));
    const left = Math.floor(exact);
    const right = Math.min(last, left + 1);
    const fraction = exact - left;
    const cx = ((track.x[left] ?? 0) + ((track.x[right] ?? 0) - (track.x[left] ?? 0)) * fraction) * tableWidth;
    const cy = ((track.y[left] ?? 0) + ((track.y[right] ?? 0) - (track.y[left] ?? 0)) * fraction) * tableWidth;
    const opacity = (track.opacity[left] ?? 0) + ((track.opacity[right] ?? 0) - (track.opacity[left] ?? 0)) * fraction;
    return {
      cx,
      cy,
      opacity,
      stripeX: cx - radius * 0.94,
      stripeY: cy - radius * 0.28,
      spotRadius: radius * 0.43,
      highlightX: cx - radius * 0.31,
      highlightY: cy - radius * 0.31,
      textX: cx - labelWidth / 2,
      textY: cy + labelBaselineOffset,
    };
  }, [labelBaselineOffset, labelWidth, progress, radius, tableWidth, track.opacity, track.x, track.y]);
  const cx = select(sample, "cx");
  const cy = select(sample, "cy");

  return <Group opacity={select(sample, "opacity")}>
    <SkiaCircle cx={cx} cy={cy} r={radius} color={track.ball.kind === "stripe" ? "#FFFDF7" : color} />
    <SkiaCircle cx={cx} cy={cy} r={radius} color="#17131A" style="stroke" strokeWidth={Math.max(0.7, radius * 0.12)} />
    {track.ball.kind === "stripe" ? <SkiaRect x={select(sample, "stripeX")} y={select(sample, "stripeY")} width={radius * 1.88} height={radius * 0.56} color={color} /> : null}
    {track.ball.id > 0 ? <SkiaCircle cx={cx} cy={cy} r={select(sample, "spotRadius")} color="#FFFDF7" /> : null}
    {track.ball.id > 0 && font ? <SkiaText x={select(sample, "textX")} y={select(sample, "textY")} text={label} font={font} color="#17131A" /> : null}
    <SkiaCircle cx={select(sample, "highlightX")} cy={select(sample, "highlightY")} r={radius * 0.2} color="rgba(255,255,255,0.5)" />
  </Group>;
}

function buildPoolTracks(frames: PoolBall[][]): PoolBallTrack[] {
  const first = frames[0] ?? [];
  return first.map((ball) => ({
    ball,
    x: frames.map((frame) => frame.find((candidate) => candidate.id === ball.id)?.x ?? ball.x),
    y: frames.map((frame) => frame.find((candidate) => candidate.id === ball.id)?.y ?? ball.y),
    opacity: frames.map((frame) => frame.find((candidate) => candidate.id === ball.id)?.pocketed ? 0 : 1),
  }));
}

function firstPocketEvent(frames: PoolBall[][], pocketed: number[], duration: number) {
  if (frames.length < 2 || pocketed.length === 0) return null;
  for (let index = 1; index < frames.length; index += 1) {
    for (const id of pocketed) {
      const before = frames[index - 1]?.find((ball) => ball.id === id);
      const after = frames[index]?.find((ball) => ball.id === id);
      if (before && after?.pocketed && !before.pocketed) {
        return {
          delay: Math.round((index / (frames.length - 1)) * duration),
          pocket: nearestPocket(before),
        };
      }
    }
  }
  return null;
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
