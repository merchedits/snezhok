import { Chess } from "chess.js";
import { assertTurn, baseState, completeGame } from "./common.js";
import type { ChessMove, ChessState, PlayerPair } from "./types.js";

export function createChess(players: PlayerPair, round = 1, scores?: Record<string, number>): ChessState {
  const chess = new Chess();
  return { ...baseState("chess", players, round, scores), kind: "chess", fen: chess.fen(), moves: [], inCheck: false };
}

export function playChess(state: ChessState, userId: string, from: string, to: string, requestedPromotion?: string): ChessState {
  assertTurn(state, userId);
  const chess = replay(state.moves);
  const expectedColor = state.players[0] === userId ? "w" : "b";
  if (chess.turn() !== expectedColor) throw new Error("It is not your color's turn");
  const normalizedPromotion = requestedPromotion === "r" || requestedPromotion === "b" || requestedPromotion === "n" ? requestedPromotion : "q";
  let moved;
  try {
    moved = chess.move({ from, to, promotion: normalizedPromotion });
  } catch {
    moved = null;
  }
  if (!moved) throw new Error("That chess move is not legal");
  const promotion: ChessMove["promotion"] | null = moved.promotion === "q" || moved.promotion === "r" || moved.promotion === "b" || moved.promotion === "n" ? moved.promotion : null;
  const move: ChessMove = { from: moved.from, to: moved.to, san: moved.san, ...(promotion ? { promotion } : {}) };
  const next: ChessState = {
    ...state,
    fen: chess.fen(),
    moves: [...state.moves, move],
    inCheck: chess.inCheck(),
    turnUserId: chess.turn() === "w" ? state.players[0] : state.players[1],
    lastActionAt: 0,
  };
  if (chess.isCheckmate()) return completeGame(next, userId);
  if (chess.isDraw()) {
    const reason = chess.isStalemate() ? "stalemate" : chess.isThreefoldRepetition() ? "repetition" : chess.isInsufficientMaterial() ? "insufficient-material" : "fifty-move";
    return completeGame(next, null, reason);
  }
  return next;
}

export function legalChessMoves(state: ChessState, from?: string): Array<{ from: string; to: string; promotion?: string }> {
  const chess = replay(state.moves);
  return chess.moves({ square: from as never, verbose: true }).map((move) => ({ from: move.from, to: move.to, ...(move.promotion ? { promotion: move.promotion } : {}) }));
}

export function chessPieces(state: ChessState): Record<string, { type: "p" | "n" | "b" | "r" | "q" | "k"; color: "w" | "b" }> {
  const chess = replay(state.moves);
  const pieces: Record<string, { type: "p" | "n" | "b" | "r" | "q" | "k"; color: "w" | "b" }> = {};
  for (const row of chess.board()) for (const piece of row) if (piece) pieces[piece.square] = { type: piece.type, color: piece.color };
  return pieces;
}

function replay(moves: ChessMove[]): Chess {
  const chess = new Chess();
  for (const move of moves) {
    try {
      chess.move({ from: move.from, to: move.to, promotion: move.promotion ?? "q" });
    } catch {
      throw new Error("Stored chess history is invalid");
    }
  }
  return chess;
}
