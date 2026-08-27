import { assertTurn, baseState, completeGame, opponent } from "./common.js";
import type { CheckersMove, CheckersPiece, CheckersState, PlayerPair } from "./types.js";

const DIAGONALS = [[-1, -1], [-1, 1], [1, -1], [1, 1]] as const;

export function createCheckers(players: PlayerPair, round = 1, scores?: Record<string, number>): CheckersState {
  const board: CheckersPiece[] = Array.from({ length: 64 }, () => null);
  for (let row = 0; row < 3; row += 1) for (let column = 0; column < 8; column += 1) if (isPlayable(row, column)) board[indexOf(row, column)] = "b";
  for (let row = 5; row < 8; row += 1) for (let column = 0; column < 8; column += 1) if (isPlayable(row, column)) board[indexOf(row, column)] = "w";
  const state = { ...baseState("checkers", players, round, scores), kind: "checkers" as const, board, forcedFrom: null, kingOnlyPlyCount: 0, positionCounts: {} };
  return { ...state, positionCounts: { [positionKey(state)]: 1 } };
}

export function legalCheckersMoves(state: CheckersState, userId: string): CheckersMove[] {
  const side = sideFor(state, userId);
  const sourceIndexes = state.forcedFrom === null ? state.board.map((_, index) => index) : [state.forcedFrom];
  const captures = sourceIndexes.flatMap((from) => capturesFrom(state.board, from, side));
  if (captures.length) return captures;
  if (state.forcedFrom !== null) return [];
  return sourceIndexes.flatMap((from) => quietMovesFrom(state.board, from, side));
}

export function playCheckers(state: CheckersState, userId: string, from: number, to: number): CheckersState {
  assertTurn(state, userId);
  const move = legalCheckersMoves(state, userId).find((candidate) => candidate.from === from && candidate.to === to);
  if (!move) throw new Error("That checkers move is not legal");
  const board = [...state.board];
  let piece = board[from];
  if (!piece) throw new Error("The selected checker is missing");
  const movedMan = piece === piece.toLowerCase();
  board[from] = null;
  if (move.capture !== null) board[move.capture] = null;
  const destinationRow = rowOf(to);
  if (piece === "w" && destinationRow === 0) piece = "W";
  if (piece === "b" && destinationRow === 7) piece = "B";
  board[to] = piece;
  const kingOnlyPlyCount = move.capture === null && !movedMan ? state.kingOnlyPlyCount + 1 : 0;
  const next: CheckersState = { ...state, board, forcedFrom: null, kingOnlyPlyCount, lastActionAt: 0 };
  if (move.capture !== null && capturesFrom(board, to, sideFor(state, userId)).length) return { ...next, forcedFrom: to, turnUserId: userId };
  const nextUserId = opponent(state, userId);
  const handedWithoutHistory: CheckersState = { ...next, turnUserId: nextUserId };
  const key = positionKey(handedWithoutHistory);
  const positionCounts = { ...state.positionCounts, [key]: (state.positionCounts[key] ?? 0) + 1 };
  const handed: CheckersState = { ...handedWithoutHistory, positionCounts };
  if (!board.some((candidate) => belongsTo(candidate, sideFor(state, nextUserId))) || legalCheckersMoves(handed, nextUserId).length === 0) return completeGame(handed, userId);
  if (positionCounts[key]! >= 3) return completeGame(handed, null, "threefold-repetition");
  if (kingOnlyPlyCount >= 30) return completeGame(handed, null, "king-move-limit");
  return handed;
}

function quietMovesFrom(board: CheckersPiece[], from: number, side: "w" | "b"): CheckersMove[] {
  const piece = board[from] ?? null;
  if (!piece || !belongsTo(piece, side)) return [];
  const row = rowOf(from);
  const column = columnOf(from);
  if (piece === piece.toUpperCase()) {
    return DIAGONALS.flatMap(([dr, dc]) => {
      const result: CheckersMove[] = [];
      for (let distance = 1; distance < 8; distance += 1) {
        const targetRow = row + dr * distance;
        const targetColumn = column + dc * distance;
        if (!inside(targetRow, targetColumn) || board[indexOf(targetRow, targetColumn)] !== null) break;
        result.push({ from, to: indexOf(targetRow, targetColumn), capture: null });
      }
      return result;
    });
  }
  const direction = side === "w" ? -1 : 1;
  return [-1, 1].flatMap((dc) => {
    const targetRow = row + direction;
    const targetColumn = column + dc;
    return inside(targetRow, targetColumn) && board[indexOf(targetRow, targetColumn)] === null
      ? [{ from, to: indexOf(targetRow, targetColumn), capture: null }]
      : [];
  });
}

function capturesFrom(board: CheckersPiece[], from: number, side: "w" | "b"): CheckersMove[] {
  const piece = board[from] ?? null;
  if (!piece || !belongsTo(piece, side)) return [];
  const row = rowOf(from);
  const column = columnOf(from);
  if (piece === piece.toUpperCase()) {
    return DIAGONALS.flatMap(([dr, dc]) => {
      let enemy: number | null = null;
      const result: CheckersMove[] = [];
      for (let distance = 1; distance < 8; distance += 1) {
        const targetRow = row + dr * distance;
        const targetColumn = column + dc * distance;
        if (!inside(targetRow, targetColumn)) break;
        const target = indexOf(targetRow, targetColumn);
        const occupant = board[target] ?? null;
        if (occupant === null) {
          if (enemy !== null) result.push({ from, to: target, capture: enemy });
          continue;
        }
        if (belongsTo(occupant, side) || enemy !== null) break;
        enemy = target;
      }
      return result;
    });
  }
  return DIAGONALS.flatMap(([dr, dc]) => {
    const enemyRow = row + dr;
    const enemyColumn = column + dc;
    const targetRow = row + dr * 2;
    const targetColumn = column + dc * 2;
    if (!inside(targetRow, targetColumn) || !inside(enemyRow, enemyColumn)) return [];
    const enemy = indexOf(enemyRow, enemyColumn);
    const target = indexOf(targetRow, targetColumn);
    return board[target] === null && board[enemy] != null && !belongsTo(board[enemy] ?? null, side) ? [{ from, to: target, capture: enemy }] : [];
  });
}

function sideFor(state: CheckersState, userId: string): "w" | "b" {
  if (state.players[0] === userId) return "w";
  if (state.players[1] === userId) return "b";
  throw new Error("Player is not part of this game");
}

function belongsTo(piece: CheckersPiece, side: "w" | "b"): boolean {
  return piece !== null && piece.toLowerCase() === side;
}

function isPlayable(row: number, column: number) { return (row + column) % 2 === 1; }
function indexOf(row: number, column: number) { return row * 8 + column; }
function rowOf(index: number) { return Math.floor(index / 8); }
function columnOf(index: number) { return index % 8; }
function inside(row: number, column: number) { return row >= 0 && row < 8 && column >= 0 && column < 8; }
function positionKey(state: Pick<CheckersState, "board" | "turnUserId">) { return `${state.board.map((piece) => piece ?? ".").join("")}:${state.turnUserId ?? "-"}`; }
