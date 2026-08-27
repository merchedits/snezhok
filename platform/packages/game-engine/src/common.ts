import type { GameBase, GameKind, GameState, PlayerPair } from "./types.js";

export function isGameKind(value: string): value is GameKind {
  return value === "tic-tac-toe" || value === "chess" || value === "checkers" || value === "sea-battle" || value === "pool";
}

export function baseState(kind: GameKind, players: PlayerPair, round = 1, scores?: Record<string, number>): GameBase {
  return {
    version: 1,
    kind,
    round,
    players,
    status: kind === "sea-battle" ? "setup" : "playing",
    turnUserId: kind === "sea-battle" ? null : players[0],
    winnerId: null,
    drawReason: null,
    scores: scores ?? { [players[0]]: 0, [players[1]]: 0 },
    rematchRequests: [],
    roundHistory: [],
    lastActionAt: null,
  };
}

export function opponent(state: Pick<GameBase, "players">, userId: string): string {
  if (state.players[0] === userId) return state.players[1];
  if (state.players[1] === userId) return state.players[0];
  throw new Error("Player is not part of this game");
}

export function assertTurn(state: GameBase, userId: string): void {
  if (state.status !== "playing") throw new Error("The game is not in progress");
  if (state.turnUserId !== userId) throw new Error("It is not your turn");
}

export function completeGame<T extends GameState>(state: T, winnerId: string | null, drawReason: string | null = null): T {
  const scores = { ...state.scores };
  if (winnerId) scores[winnerId] = (scores[winnerId] ?? 0) + 1;
  return {
    ...state,
    status: "completed",
    turnUserId: null,
    winnerId,
    drawReason,
    scores,
    rematchRequests: [],
    roundHistory: [...state.roundHistory, { round: state.round, winnerId, drawReason, completedAt: 0 }],
    lastActionAt: 0,
  };
}

export function isBaseGameState(value: unknown): value is GameState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const state = value as Partial<GameState>;
  return state.version === 1
    && typeof state.kind === "string"
    && isGameKind(state.kind)
    && Number.isInteger(state.round)
    && Array.isArray(state.players)
    && state.players.length === 2
    && state.players.every((player) => typeof player === "string")
    && (state.status === "setup" || state.status === "playing" || state.status === "completed")
    && (state.turnUserId === null || typeof state.turnUserId === "string")
    && (state.winnerId === null || typeof state.winnerId === "string")
    && Boolean(state.scores && typeof state.scores === "object")
    && Array.isArray(state.rematchRequests)
    && Array.isArray(state.roundHistory);
}

export function playerPair(players: readonly string[], firstPlayerId?: string): PlayerPair {
  if (players.length !== 2 || players[0] === players[1]) throw new Error("A game requires exactly two different players");
  const first = firstPlayerId && players.includes(firstPlayerId) ? firstPlayerId : players[0]!;
  const second = players.find((player) => player !== first)!;
  return [first, second];
}
