import { assertTurn, baseState, completeGame } from "./common.js";
import type { PlayerPair, TicTacToeState } from "./types.js";

const WINNING_LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
] as const;

export function createTicTacToe(players: PlayerPair, round = 1, scores?: Record<string, number>): TicTacToeState {
  return { ...baseState("tic-tac-toe", players, round, scores), kind: "tic-tac-toe", board: Array.from({ length: 9 }, () => null) };
}

export function playTicTacToe(state: TicTacToeState, userId: string, cell: number): TicTacToeState {
  assertTurn(state, userId);
  if (!Number.isInteger(cell) || cell < 0 || cell > 8 || state.board[cell] !== null) throw new Error("Choose an empty square");
  const board = [...state.board];
  const mark = state.players[0] === userId ? "x" : "o";
  board[cell] = mark;
  const next = { ...state, board, lastActionAt: 0 };
  if (WINNING_LINES.some((line) => line.every((index) => board[index] === mark))) return completeGame(next, userId);
  if (board.every(Boolean)) return completeGame(next, null, "draw");
  return { ...next, turnUserId: state.players[0] === userId ? state.players[1] : state.players[0] };
}
