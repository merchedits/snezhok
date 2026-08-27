export const GAME_KINDS = ["tic-tac-toe", "chess", "checkers", "sea-battle", "pool"] as const;
export type GameKind = (typeof GAME_KINDS)[number];
export type GameStatus = "setup" | "playing" | "completed";
export type PlayerPair = [string, string];

export interface GameBase {
  version: 1;
  kind: GameKind;
  round: number;
  players: PlayerPair;
  status: GameStatus;
  turnUserId: string | null;
  winnerId: string | null;
  drawReason: string | null;
  scores: Record<string, number>;
  rematchRequests: string[];
  roundHistory: Array<{ round: number; winnerId: string | null; drawReason: string | null; completedAt: number }>;
  lastActionAt: number | null;
}

export interface TicTacToeState extends GameBase {
  kind: "tic-tac-toe";
  board: Array<"x" | "o" | null>;
}

export interface ChessMove {
  from: string;
  to: string;
  promotion?: "q" | "r" | "b" | "n";
  san: string;
}

export interface ChessState extends GameBase {
  kind: "chess";
  fen: string;
  moves: ChessMove[];
  inCheck: boolean;
}

export type CheckersPiece = "w" | "W" | "b" | "B" | null;
export interface CheckersState extends GameBase {
  kind: "checkers";
  board: CheckersPiece[];
  forcedFrom: number | null;
  kingOnlyPlyCount: number;
  positionCounts: Record<string, number>;
}

export interface SeaBattleShot {
  cell: number;
  outcome: "miss" | "hit" | "sunk";
  sunkCells?: number[];
}

export interface SeaBattleState extends GameBase {
  kind: "sea-battle";
  status: "setup" | "playing" | "completed";
  readyUserIds: string[];
  shots: Record<string, SeaBattleShot[]>;
  revealedFleets?: Record<string, number[][]>;
}

export interface SeaBattlePrivateState {
  fleet: number[][];
}

export type PoolBallKind = "cue" | "solid" | "stripe" | "eight";
export interface PoolBall {
  id: number;
  kind: PoolBallKind;
  x: number;
  y: number;
  pocketed: boolean;
}

export interface PoolLastShot {
  shooterId: string;
  angle: number;
  power: number;
  cueX?: number;
  cueY?: number;
  pocketed: number[];
  foul: boolean;
}

export interface PoolState extends GameBase {
  kind: "pool";
  balls: PoolBall[];
  groups: Record<string, "solid" | "stripe" | null>;
  ballInHandUserId: string | null;
  breakShot: boolean;
  lastShot: PoolLastShot | null;
}

export type GameState = TicTacToeState | ChessState | CheckersState | SeaBattleState | PoolState;

export interface CheckersMove {
  from: number;
  to: number;
  capture: number | null;
}

export interface PoolShotInput {
  angle: number;
  power: number;
  cueX?: number;
  cueY?: number;
}
