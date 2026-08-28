import { assertTurn, baseState, completeGame, opponent } from "./common.js";
import type { PlayerPair, PoolBall, PoolShotInput, PoolState } from "./types.js";

export const POOL_GEOMETRY = {
  minX: 0.055,
  maxX: 0.945,
  minY: 0.055,
  maxY: 0.445,
  ballRadius: 0.015,
  pocketRadius: 0.035,
  pockets: [[0.055, 0.055], [0.5, 0.047], [0.945, 0.055], [0.055, 0.445], [0.5, 0.453], [0.945, 0.445]],
} as const;

const BALL_RADIUS = POOL_GEOMETRY.ballRadius;
const POCKETS = POOL_GEOMETRY.pockets;
const CENTER_MIN_X = POOL_GEOMETRY.minX + BALL_RADIUS;
const CENTER_MAX_X = POOL_GEOMETRY.maxX - BALL_RADIUS;
const CENTER_MIN_Y = POOL_GEOMETRY.minY + BALL_RADIUS;
const CENTER_MAX_Y = POOL_GEOMETRY.maxY - BALL_RADIUS;

interface MovingBall extends PoolBall { vx: number; vy: number; }

export function createPool(players: PlayerPair, round = 1, scores?: Record<string, number>): PoolState {
  return {
    ...baseState("pool", players, round, scores),
    kind: "pool",
    balls: rackBalls(),
    groups: { [players[0]]: null, [players[1]]: null },
    ballInHandUserId: null,
    breakShot: true,
    lastShot: null,
  };
}

export function playPool(state: PoolState, userId: string, input: PoolShotInput): PoolState {
  assertTurn(state, userId);
  const angle = finiteBetween(input.angle, -Math.PI * 2, Math.PI * 2, "Aim is invalid");
  const power = finiteBetween(input.power, 0.12, 1, "Shot power is invalid");
  const balls = state.balls.map((ball) => ({ ...ball }));
  const cue = balls.find((ball) => ball.id === 0)!;
  if (state.ballInHandUserId === userId) {
    const x = finiteBetween(input.cueX, CENTER_MIN_X, CENTER_MAX_X, "Place the cue ball on the table");
    const y = finiteBetween(input.cueY, CENTER_MIN_Y, CENTER_MAX_Y, "Place the cue ball on the table");
    if (balls.some((ball) => ball.id !== 0 && !ball.pocketed && distance(ball.x, ball.y, x, y) < BALL_RADIUS * 2.05)) throw new Error("The cue ball cannot overlap another ball");
    cue.x = x;
    cue.y = y;
    cue.pocketed = false;
  } else if (cue.pocketed) {
    cue.x = 0.25;
    cue.y = 0.25;
    cue.pocketed = false;
  }
  const simulation = simulate(balls, angle, power);
  const nextPlayerId = opponent(state, userId);
  const shooterGroup = state.groups[userId];
  const targetIds = shooterGroup
    ? state.balls.filter((ball) => ball.kind === shooterGroup && !ball.pocketed).map((ball) => ball.id)
    : state.balls.filter((ball) => !ball.pocketed && (ball.kind === "solid" || ball.kind === "stripe")).map((ball) => ball.id);
  const first = state.balls.find((ball) => ball.id === simulation.firstContactId);
  const mustHitEight = Boolean(shooterGroup) && targetIds.length === 0;
  const wrongFirstContact = !first || (mustHitEight ? first.kind !== "eight" : shooterGroup ? first.kind !== shooterGroup : first.kind === "eight");
  const cuePocketed = simulation.pocketed.includes(0);
  const noRailOrPocket = !simulation.railAfterContact && simulation.pocketed.length === 0;
  const foul = cuePocketed || wrongFirstContact || noRailOrPocket;
  const eightPocketed = simulation.pocketed.includes(8);
  const baseNext: PoolState = {
    ...state,
    balls: simulation.balls,
    breakShot: false,
    lastActionAt: 0,
    lastShot: { shooterId: userId, angle, power, pocketed: simulation.pocketed, foul, ...(state.ballInHandUserId === userId ? { cueX: cue.x, cueY: cue.y } : {}) },
    ballInHandUserId: foul ? nextPlayerId : null,
  };
  if (eightPocketed) return completeGame(baseNext, !foul && mustHitEight ? userId : nextPlayerId);

  let groups = { ...state.groups };
  const objectPocketed = simulation.pocketed.map((id) => simulation.balls.find((ball) => ball.id === id)).filter((ball): ball is PoolBall => Boolean(ball && (ball.kind === "solid" || ball.kind === "stripe")));
  if (!foul && !groups[userId] && objectPocketed.length) {
    const group = objectPocketed[0]!.kind as "solid" | "stripe";
    groups = { ...groups, [userId]: group, [nextPlayerId]: group === "solid" ? "stripe" : "solid" };
  }
  const retainedTurn = !foul && objectPocketed.some((ball) => !groups[userId] || ball.kind === groups[userId]);
  return { ...baseNext, groups, turnUserId: retainedTurn ? userId : nextPlayerId };
}

export function tracePoolShot(inputBalls: PoolBall[], angle: number, power: number, cuePosition?: { x: number; y: number }): PoolBall[][] {
  const balls = inputBalls.map((ball) => ({ ...ball }));
  if (cuePosition) {
    const cue = balls.find((ball) => ball.id === 0)!;
    cue.x = cuePosition.x;
    cue.y = cuePosition.y;
    cue.pocketed = false;
  }
  return simulate(balls, angle, power, true).frames;
}

function simulate(inputBalls: PoolBall[], angle: number, power: number, collectFrames = false) {
  const balls: MovingBall[] = inputBalls.map((ball) => ({ ...ball, vx: 0, vy: 0 }));
  const cue = balls.find((ball) => ball.id === 0)!;
  cue.vx = Math.cos(angle) * (0.72 + power * 1.7);
  cue.vy = Math.sin(angle) * (0.72 + power * 1.7);
  const pocketed: number[] = [];
  let firstContactId: number | null = null;
  let railAfterContact = false;
  const frames: PoolBall[][] = collectFrames ? [snapshot(balls)] : [];
  const dt = 0.004;
  for (let step = 0; step < 2_400; step += 1) {
    let moving = false;
    for (const ball of balls) {
      if (ball.pocketed) continue;
      if (Math.hypot(ball.vx, ball.vy) > 0.004) moving = true;
      ball.x += ball.vx * dt;
      ball.y += ball.vy * dt;
      const pocket = POCKETS.some(([x, y]) => distance(ball.x, ball.y, x, y) <= POOL_GEOMETRY.pocketRadius);
      if (pocket) {
        ball.pocketed = true;
        ball.vx = 0;
        ball.vy = 0;
        pocketed.push(ball.id);
        continue;
      }
      let rail = false;
      if (ball.x < CENTER_MIN_X) { ball.x = CENTER_MIN_X; ball.vx = Math.abs(ball.vx) * 0.83; rail = true; }
      if (ball.x > CENTER_MAX_X) { ball.x = CENTER_MAX_X; ball.vx = -Math.abs(ball.vx) * 0.83; rail = true; }
      if (ball.y < CENTER_MIN_Y) { ball.y = CENTER_MIN_Y; ball.vy = Math.abs(ball.vy) * 0.83; rail = true; }
      if (ball.y > CENTER_MAX_Y) { ball.y = CENTER_MAX_Y; ball.vy = -Math.abs(ball.vy) * 0.83; rail = true; }
      if (rail && firstContactId !== null) railAfterContact = true;
      ball.vx *= 0.992;
      ball.vy *= 0.992;
      if (Math.hypot(ball.vx, ball.vy) < 0.004) { ball.vx = 0; ball.vy = 0; }
    }
    for (let left = 0; left < balls.length; left += 1) for (let right = left + 1; right < balls.length; right += 1) {
      const a = balls[left]!;
      const b = balls[right]!;
      if (a.pocketed || b.pocketed) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const separation = Math.hypot(dx, dy);
      if (separation <= 0 || separation >= BALL_RADIUS * 2) continue;
      if (firstContactId === null && (a.id === 0 || b.id === 0)) firstContactId = a.id === 0 ? b.id : a.id;
      const nx = dx / separation;
      const ny = dy / separation;
      const relative = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
      if (relative > 0) {
        const impulse = relative * 0.96;
        a.vx -= impulse * nx;
        a.vy -= impulse * ny;
        b.vx += impulse * nx;
        b.vy += impulse * ny;
      }
      const overlap = BALL_RADIUS * 2 - separation;
      a.x -= nx * overlap * 0.5;
      a.y -= ny * overlap * 0.5;
      b.x += nx * overlap * 0.5;
      b.y += ny * overlap * 0.5;
    }
    if (collectFrames && step % 20 === 0) frames.push(snapshot(balls));
    if (!moving && step > 10) break;
  }
  if (collectFrames) frames.push(snapshot(balls));
  return {
    balls: balls.map(({ vx: _vx, vy: _vy, ...ball }) => ({ ...ball, x: rounded(ball.x), y: rounded(ball.y) })),
    pocketed,
    firstContactId,
    railAfterContact,
    frames,
  };
}

function rackBalls(): PoolBall[] {
  const balls: PoolBall[] = [{ id: 0, kind: "cue", x: 0.25, y: 0.25, pocketed: false }];
  const order = [1, 9, 2, 10, 8, 3, 11, 4, 12, 5, 13, 6, 14, 7, 15];
  let cursor = 0;
  for (let row = 0; row < 5; row += 1) {
    for (let offset = 0; offset <= row; offset += 1) {
      const id = order[cursor++]!;
      balls.push({
        id,
        kind: id === 8 ? "eight" : id < 8 ? "solid" : "stripe",
        x: rounded(0.69 + row * BALL_RADIUS * 1.78),
        y: rounded(0.25 + (offset - row / 2) * BALL_RADIUS * 2.04),
        pocketed: false,
      });
    }
  }
  return balls;
}

function finiteBetween(value: unknown, min: number, max: number, message: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) throw new Error(message);
  return value;
}
function distance(ax: number, ay: number, bx: number, by: number) { return Math.hypot(ax - bx, ay - by); }
function rounded(value: number) { return Math.round(value * 100_000) / 100_000; }
function snapshot(balls: MovingBall[]): PoolBall[] { return balls.map(({ vx: _vx, vy: _vy, ...ball }) => ({ ...ball, x: rounded(ball.x), y: rounded(ball.y) })); }
