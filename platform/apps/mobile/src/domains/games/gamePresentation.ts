import { chessPieces, POOL_TRACE_FPS, type CheckersState, type ChessState, type PoolBall } from "@snezhok/game-engine";

const chessValues = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 } as const;

/** Chess.com-style material advantage: only the player who is currently
 * ahead receives a positive counter. */
export function materialAdvantage(state: ChessState | CheckersState, playerIndex: 0 | 1): number {
  const totals = state.kind === "chess" ? chessMaterial(state) : checkersMaterial(state);
  return Math.max(0, totals[playerIndex] - totals[playerIndex === 0 ? 1 : 0]);
}

function chessMaterial(state: ChessState): [number, number] {
  let white = 0;
  let black = 0;
  for (const piece of Object.values(chessPieces(state))) {
    if (!piece) continue;
    if (piece.color === "w") white += chessValues[piece.type];
    else black += chessValues[piece.type];
  }
  return [white, black];
}

function checkersMaterial(state: CheckersState): [number, number] {
  let light = 0;
  let dark = 0;
  for (const piece of state.board) {
    if (piece === "w") light += 1;
    else if (piece === "W") light += 3;
    else if (piece === "b") dark += 1;
    else if (piece === "B") dark += 3;
  }
  return [light, dark];
}

export interface PoolShotGesture {
  angle: number;
  power: number;
  pullDistance: number;
}

export interface PoolGesturePoint {
  x: number;
  y: number;
}

/** Keeps a captured pool gesture in table coordinates even after the finger
 * leaves the rendered table. React Native continues delivering responder
 * deltas outside the view, so this point must deliberately remain unclamped. */
export function poolPullPoint(start: PoolGesturePoint, deltaX: number, deltaY: number, tableWidth: number): PoolGesturePoint {
  const scale = Number.isFinite(tableWidth) && tableWidth > 0 ? tableWidth : 1;
  return { x: start.x + deltaX / scale, y: start.y + deltaY / scale };
}

/** The deterministic engine emits equally spaced 60 Hz snapshots. Playback
 * keeps that physical clock instead of compressing long shots into a jumpy
 * arbitrary duration. */
export function poolPlaybackDuration(frameCount: number): number {
  return Math.max(0, Math.round((Math.max(1, Math.floor(frameCount)) - 1) * 1_000 / POOL_TRACE_FPS));
}

/** Converts a slingshot gesture into the deterministic server shot. Coordinates
 * use the engine's table system: x=0..1 and y=0..0.5, which maps to equal
 * physical units on a 2:1 table. */
export function poolShotFromPull(cue: Pick<PoolBall, "x" | "y">, pull: { x: number; y: number }): PoolShotGesture | null {
  const dx = pull.x - cue.x;
  const dy = pull.y - cue.y;
  const pullDistance = Math.hypot(dx, dy);
  if (pullDistance < 0.018) return null;
  return {
    angle: Math.atan2(-dy, -dx),
    power: clamp(pullDistance / 0.24, 0.12, 1),
    pullDistance,
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
