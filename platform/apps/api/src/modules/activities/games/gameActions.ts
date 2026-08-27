import {
  createSeaBattlePrivateState,
  fireSeaBattle,
  generateFleet,
  parseGameState,
  playCheckers,
  playChess,
  playPool,
  playTicTacToe,
  readySeaBattle,
  requestGameRematch,
  resignGame,
  validateFleet,
  type GameState,
  type SeaBattleState,
} from "@snezhok/game-engine";
import type { DbClient } from "../../../db/pool.js";
import { conflict } from "../../../lib/errors.js";
import type { ActionResult, ActivityCommandInput, ActivityRow } from "../activityModel.js";

export async function mutateGame(
  client: DbClient,
  activity: ActivityRow,
  userId: string,
  action: ActivityCommandInput["action"],
  payload: Record<string, unknown>,
): Promise<ActionResult> {
  const state = engine(() => parseGameState(activity.result));
  if (state.kind !== activity.type) throw conflict("Stored game state does not match this activity");
  if (action === "game-rematch") return rematch(client, activity.id, state, userId);
  if (action === "game-resign") {
    const next = engine(() => resignGame(state, userId));
    await markPlayers(client, activity.id, "completed");
    return gameResult(next, true);
  }
  if (state.kind === "sea-battle") return mutateSeaBattle(client, activity.id, state, userId, action, payload);
  if (action !== "game-move") throw conflict("This game action is not available");
  const next = applyPublicMove(state, userId, payload);
  if (next.status === "completed") await markPlayers(client, activity.id, "completed");
  return gameResult(next, next.status === "completed");
}

async function rematch(client: DbClient, activityId: string, state: GameState, userId: string): Promise<ActionResult> {
  const rematch = engine(() => requestGameRematch(state, userId));
  if (!rematch.restarted) return gameResult(rematch.state, false);
  await markPlayers(client, activityId, "active");
  if (rematch.state.kind === "sea-battle") {
    for (const participantId of rematch.state.players) {
      await client.query("UPDATE cooperative_activity_participants SET private_state=$3,status='active',submitted_at=NULL,updated_at=now() WHERE activity_id=$1 AND user_id=$2", [activityId, participantId, createSeaBattlePrivateState()]);
    }
  }
  return { ...gameResult(rematch.state, false), state: "active", resetCompletedAt: true };
}

async function mutateSeaBattle(
  client: DbClient,
  activityId: string,
  state: SeaBattleState,
  userId: string,
  action: ActivityCommandInput["action"],
  payload: Record<string, unknown>,
): Promise<ActionResult> {
  if (action === "game-shuffle") {
    if (state.status !== "setup" || state.readyUserIds.includes(userId)) throw conflict("Your fleet is already locked");
    const fleet = generateFleet();
    await client.query("UPDATE cooperative_activity_participants SET private_state=$3,updated_at=now() WHERE activity_id=$1 AND user_id=$2", [activityId, userId, { fleet }]);
    return gameResult(state, false);
  }
  const fleets = await readFleets(client, activityId);
  if (action === "game-ready") {
    const ownFleet = fleets[userId];
    if (!ownFleet) throw conflict("Your fleet is unavailable");
    const next = engine(() => readySeaBattle(state, userId, ownFleet));
    return gameResult(next, false);
  }
  if (action !== "game-move") throw conflict("This Battleship action is not available");
  const next = engine(() => fireSeaBattle(state, userId, requiredInteger(payload.cell, 0, 99), fleets));
  if (next.status === "completed") await markPlayers(client, activityId, "completed");
  return gameResult(next, next.status === "completed");
}

function applyPublicMove(state: Exclude<GameState, SeaBattleState>, userId: string, payload: Record<string, unknown>): GameState {
  return engine(() => {
    switch (state.kind) {
      case "tic-tac-toe": return playTicTacToe(state, userId, requiredInteger(payload.cell, 0, 8));
      case "chess": return playChess(state, userId, requiredString(payload.from, 2, 2), requiredString(payload.to, 2, 2), optionalString(payload.promotion));
      case "checkers": return playCheckers(state, userId, requiredInteger(payload.from, 0, 63), requiredInteger(payload.to, 0, 63));
      case "pool": return playPool(state, userId, {
        angle: requiredNumber(payload.angle),
        power: requiredNumber(payload.power),
        ...(typeof payload.cueX === "number" ? { cueX: payload.cueX } : {}),
        ...(typeof payload.cueY === "number" ? { cueY: payload.cueY } : {}),
      });
    }
  });
}

async function readFleets(client: DbClient, activityId: string): Promise<Record<string, number[][]>> {
  const rows = await client.query<{ user_id: string; private_state: Record<string, unknown> }>("SELECT user_id,private_state FROM cooperative_activity_participants WHERE activity_id=$1 FOR UPDATE", [activityId]);
  const fleets: Record<string, number[][]> = {};
  for (const row of rows.rows) {
    const fleet = row.private_state.fleet;
    if (Array.isArray(fleet) && validateFleet(fleet as number[][])) fleets[row.user_id] = fleet as number[][];
  }
  return fleets;
}

async function markPlayers(client: DbClient, activityId: string, status: "active" | "completed") {
  await client.query(
    `UPDATE cooperative_activity_participants SET status=$2,submitted_at=CASE WHEN $2='completed' THEN now() ELSE NULL END,updated_at=now() WHERE activity_id=$1`,
    [activityId, status],
  );
}

function gameResult(state: GameState, completed: boolean): ActionResult {
  const stamped = stampGameState(state);
  return {
    state: state.status === "completed" ? "completed" : "active",
    result: stamped as unknown as Record<string, unknown>,
    ...(completed ? { completed: true } : {}),
  };
}

function stampGameState(state: GameState): GameState {
  const now = Date.now();
  const roundHistory = state.roundHistory.map((round, index) => index === state.roundHistory.length - 1 && round.completedAt === 0 ? { ...round, completedAt: now } : round);
  return { ...state, lastActionAt: now, roundHistory } as GameState;
}

function engine<T>(operation: () => T): T {
  try {
    return operation();
  } catch (error) {
    throw conflict(error instanceof Error ? error.message : "The game move is invalid");
  }
}

function requiredInteger(value: unknown, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) throw new Error("Game move coordinates are invalid");
  return value;
}
function requiredNumber(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("Game move value is invalid");
  return value;
}
function requiredString(value: unknown, min: number, max: number): string {
  if (typeof value !== "string" || value.length < min || value.length > max) throw new Error("Game move value is invalid");
  return value;
}
function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
