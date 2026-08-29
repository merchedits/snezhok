import { assertTurn, baseState, completeGame, opponent } from "./common.js";
import type { PlayerPair, PoolBall, PoolShotInput, PoolState } from "./types.js";
import { Circle, Edge, Vec2, World, type Body, type Contact } from "planck";

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
export const POOL_TRACE_FPS = 60;

const PHYSICS_FPS = 240;
const PHYSICS_STEP = 1 / PHYSICS_FPS;
// Box2D's contact tolerance is expressed in world units. Keeping the normalized
// 0..1 render coordinates directly in the solver makes that tolerance enormous
// relative to a pool ball. A 10x physics world keeps balls in Box2D's preferred
// size range and is converted back only at the snapshot boundary.
const PHYSICS_SCALE = 10;
const TRACE_EVERY_STEPS = PHYSICS_FPS / POOL_TRACE_FPS;
const MAX_SHOT_SECONDS = 8;
const MAX_SHOT_STEPS = PHYSICS_FPS * MAX_SHOT_SECONDS;
const VELOCITY_ITERATIONS = 16;
const POSITION_ITERATIONS = 20;
const BALL_RESTITUTION = 0.96;
const CUSHION_RESTITUTION = 0.86;
const ROLLING_DECELERATION = 0.12;
const STOP_SPEED = 0.003;

interface BallBodyData { type: "ball"; id: number; }
interface RailBodyData { type: "rail"; }
type PhysicsBodyData = BallBodyData | RailBodyData;

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
  const world = new World({ gravity: Vec2(0, 0), allowSleep: true, continuousPhysics: true, warmStarting: true, blockSolve: true });
  const rail = world.createBody({ userData: { type: "rail" } satisfies RailBodyData });
  const railFixture = { friction: 0, restitution: CUSHION_RESTITUTION };
  rail.createFixture(new Edge(physicsPoint(POOL_GEOMETRY.minX, POOL_GEOMETRY.minY), physicsPoint(POOL_GEOMETRY.maxX, POOL_GEOMETRY.minY)), railFixture);
  rail.createFixture(new Edge(physicsPoint(POOL_GEOMETRY.maxX, POOL_GEOMETRY.minY), physicsPoint(POOL_GEOMETRY.maxX, POOL_GEOMETRY.maxY)), railFixture);
  rail.createFixture(new Edge(physicsPoint(POOL_GEOMETRY.maxX, POOL_GEOMETRY.maxY), physicsPoint(POOL_GEOMETRY.minX, POOL_GEOMETRY.maxY)), railFixture);
  rail.createFixture(new Edge(physicsPoint(POOL_GEOMETRY.minX, POOL_GEOMETRY.maxY), physicsPoint(POOL_GEOMETRY.minX, POOL_GEOMETRY.minY)), railFixture);

  const bodies = new Map<number, Body>();
  for (const ball of inputBalls) {
    if (ball.pocketed) continue;
    const body = world.createDynamicBody({
      position: physicsPoint(ball.x, ball.y),
      fixedRotation: true,
      bullet: ball.id === 0,
      allowSleep: true,
      userData: { type: "ball", id: ball.id } satisfies BallBodyData,
    });
    body.createFixture(new Circle(BALL_RADIUS * PHYSICS_SCALE), { density: 1, friction: 0, restitution: BALL_RESTITUTION });
    bodies.set(ball.id, body);
  }
  const cue = bodies.get(0);
  if (!cue) throw new Error("Cue ball is unavailable");
  const launchSpeed = 0.45 + power * 1.25;
  cue.setLinearVelocity(Vec2(Math.cos(angle) * launchSpeed * PHYSICS_SCALE, Math.sin(angle) * launchSpeed * PHYSICS_SCALE));
  cue.setAwake(true);

  const pocketed: number[] = [];
  let firstContactId: number | null = null;
  let railAfterContact = false;
  world.on("begin-contact", (contact) => {
    const [first, second] = contactData(contact);
    if (!first || !second) return;
    if (first.type === "ball" && second.type === "ball" && firstContactId === null) {
      if (first.id === 0 && second.id !== 0) firstContactId = second.id;
      else if (second.id === 0 && first.id !== 0) firstContactId = first.id;
    }
    if (firstContactId !== null && ((first.type === "ball" && second.type === "rail") || (first.type === "rail" && second.type === "ball"))) {
      railAfterContact = true;
    }
  });

  const ballsById = new Map(inputBalls.map((ball) => [ball.id, { ...ball }]));
  const frames: PoolBall[][] = collectFrames ? [snapshotPoolBalls(ballsById, bodies)] : [];
  for (let step = 1; step <= MAX_SHOT_STEPS; step += 1) {
    world.step(PHYSICS_STEP, VELOCITY_ITERATIONS, POSITION_ITERATIONS);
    capturePocketedBalls(ballsById, bodies, pocketed);
    const moving = applyRollingResistance(bodies, PHYSICS_STEP);
    if (collectFrames && step % TRACE_EVERY_STEPS === 0) frames.push(snapshotPoolBalls(ballsById, bodies));
    if (!moving && step > TRACE_EVERY_STEPS * 2) break;
  }
  const finalBalls = snapshotPoolBalls(ballsById, bodies);
  if (collectFrames && !sameBallSnapshot(frames.at(-1), finalBalls)) frames.push(finalBalls);
  return {
    balls: finalBalls,
    pocketed,
    firstContactId,
    railAfterContact,
    frames,
  };
}

function contactData(contact: Contact): [PhysicsBodyData | null, PhysicsBodyData | null] {
  return [physicsBodyData(contact.getFixtureA().getBody()), physicsBodyData(contact.getFixtureB().getBody())];
}

function physicsBodyData(body: Body): PhysicsBodyData | null {
  const value = body.getUserData();
  if (!value || typeof value !== "object" || !("type" in value)) return null;
  if (value.type === "rail") return { type: "rail" };
  if (value.type === "ball" && "id" in value && typeof value.id === "number") return { type: "ball", id: value.id };
  return null;
}

function capturePocketedBalls(balls: Map<number, PoolBall>, bodies: Map<number, Body>, pocketed: number[]) {
  for (const [id, body] of bodies) {
    if (!body.isActive()) continue;
    const position = body.getPosition();
    const pocket = POCKETS.find(([x, y]) => distance(position.x, position.y, x * PHYSICS_SCALE, y * PHYSICS_SCALE) <= POOL_GEOMETRY.pocketRadius * PHYSICS_SCALE);
    if (!pocket) continue;
    const ball = balls.get(id);
    if (!ball) continue;
    ball.x = pocket[0];
    ball.y = pocket[1];
    ball.pocketed = true;
    body.setLinearVelocity(Vec2(0, 0));
    body.setPosition(physicsPoint(pocket[0], pocket[1]));
    body.setActive(false);
    pocketed.push(id);
  }
}

function applyRollingResistance(bodies: Map<number, Body>, dt: number): boolean {
  let moving = false;
  for (const body of bodies.values()) {
    if (!body.isActive()) continue;
    const velocity = body.getLinearVelocity();
    const speed = Math.hypot(velocity.x, velocity.y);
    const nextSpeed = Math.max(0, speed - ROLLING_DECELERATION * PHYSICS_SCALE * dt);
    if (nextSpeed <= STOP_SPEED * PHYSICS_SCALE) {
      body.setLinearVelocity(Vec2(0, 0));
      body.setAwake(false);
      continue;
    }
    body.setLinearVelocity(Vec2(velocity.x * nextSpeed / speed, velocity.y * nextSpeed / speed));
    moving = true;
  }
  return moving;
}

function snapshotPoolBalls(balls: Map<number, PoolBall>, bodies: Map<number, Body>): PoolBall[] {
  return [...balls.values()].map((ball) => {
    const body = bodies.get(ball.id);
    if (!body || ball.pocketed) return { ...ball, x: rounded(ball.x), y: rounded(ball.y) };
    const position = body.getPosition();
    return { ...ball, x: rounded(position.x / PHYSICS_SCALE), y: rounded(position.y / PHYSICS_SCALE) };
  });
}

function physicsPoint(x: number, y: number) { return Vec2(x * PHYSICS_SCALE, y * PHYSICS_SCALE); }

function sameBallSnapshot(first: PoolBall[] | undefined, second: PoolBall[]) {
  return Boolean(first && first.length === second.length && first.every((ball, index) => {
    const candidate = second[index];
    return candidate && ball.id === candidate.id && ball.x === candidate.x && ball.y === candidate.y && ball.pocketed === candidate.pocketed;
  }));
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
