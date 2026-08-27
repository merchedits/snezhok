export * from "./types.js";
export * from "./common.js";
export * from "./ticTacToe.js";
export * from "./chess.js";
export * from "./checkers.js";
export * from "./seaBattle.js";
export * from "./pool.js";

import { createCheckers } from "./checkers.js";
import { createChess } from "./chess.js";
import { completeGame, isBaseGameState, opponent, playerPair } from "./common.js";
import { createPool } from "./pool.js";
import { createSeaBattle } from "./seaBattle.js";
import { createTicTacToe } from "./ticTacToe.js";
import type { GameKind, GameState, PlayerPair } from "./types.js";

export function createGame(kind: GameKind, players: readonly string[], firstPlayerId?: string): GameState {
  return createRound(kind, playerPair(players, firstPlayerId));
}

export function parseGameState(value: unknown): GameState {
  if (!isBaseGameState(value)) throw new Error("Stored game state is malformed");
  const state = value as GameState;
  if (state.kind === "tic-tac-toe" && Array.isArray(state.board) && state.board.length === 9 && state.board.every((cell) => cell === null || cell === "x" || cell === "o")) return state;
  if (state.kind === "chess" && typeof state.fen === "string" && Array.isArray(state.moves) && typeof state.inCheck === "boolean") return state;
  if (state.kind === "checkers" && Array.isArray(state.board) && state.board.length === 64 && state.board.every((piece) => piece === null || piece === "w" || piece === "W" || piece === "b" || piece === "B") && Number.isInteger(state.kingOnlyPlyCount) && Boolean(state.positionCounts && typeof state.positionCounts === "object")) return state;
  if (state.kind === "sea-battle" && Array.isArray(state.readyUserIds) && Boolean(state.shots && typeof state.shots === "object")) return state;
  if (state.kind === "pool" && Array.isArray(state.balls) && state.balls.length === 16 && Boolean(state.groups && typeof state.groups === "object")) return state;
  throw new Error("Stored game state does not match its game kind");
}

export function requestGameRematch(state: GameState, userId: string): { state: GameState; restarted: boolean } {
  if (state.status !== "completed") throw new Error("Finish the current game before requesting a rematch");
  if (!state.players.includes(userId)) throw new Error("Player is not part of this game");
  const requests = [...new Set([...state.rematchRequests, userId])];
  if (requests.length < 2) return { state: { ...state, rematchRequests: requests, lastActionAt: 0 }, restarted: false };
  const players: PlayerPair = [state.players[1], state.players[0]];
  const next = createRound(state.kind, players, state.round + 1, state.scores);
  return { state: { ...next, roundHistory: [...state.roundHistory] } as GameState, restarted: true };
}

export function resignGame(state: GameState, userId: string): GameState {
  if (state.status === "completed") throw new Error("The game is already complete");
  return completeGame(state, opponent(state, userId), "resignation");
}

function createRound(kind: GameKind, players: PlayerPair, round = 1, scores?: Record<string, number>): GameState {
  switch (kind) {
    case "tic-tac-toe": return createTicTacToe(players, round, scores);
    case "chess": return createChess(players, round, scores);
    case "checkers": return createCheckers(players, round, scores);
    case "sea-battle": return createSeaBattle(players, round, scores);
    case "pool": return createPool(players, round, scores);
  }
}
