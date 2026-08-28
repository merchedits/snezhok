import assert from "node:assert/strict";
import test from "node:test";
import {
  createCheckers, createChess, createPool, createSeaBattle, createTicTacToe,
  chessPieces, fireSeaBattle, generateFleet, legalCheckersMoves, parseGameState, playCheckers, playChess, playPool,
  playTicTacToe, readySeaBattle, requestGameRematch, tracePoolShot, validateFleet,
} from "./index.js";

const players: [string, string] = ["alice", "bob"];

test("tic-tac-toe enforces turns, wins, and restarts with the other player", () => {
  let state = createTicTacToe(players);
  assert.throws(() => playTicTacToe(state, "bob", 0));
  state = playTicTacToe(state, "alice", 0);
  state = playTicTacToe(state, "bob", 3);
  state = playTicTacToe(state, "alice", 1);
  state = playTicTacToe(state, "bob", 4);
  state = playTicTacToe(state, "alice", 2);
  assert.equal(state.winnerId, "alice");
  const requested = requestGameRematch(state, "alice");
  assert.equal(requested.restarted, false);
  const restarted = requestGameRematch(requested.state, "bob");
  assert.equal(restarted.restarted, true);
  assert.deepEqual(restarted.state.players, ["bob", "alice"]);
  assert.equal(restarted.state.scores.alice, 1);
});

test("chess.js integration recognizes checkmate and rejects illegal moves", () => {
  let state = createChess(players);
  assert.throws(() => playChess(state, "alice", "e2", "e5"));
  state = playChess(state, "alice", "f2", "f3");
  state = playChess(state, "bob", "e7", "e5");
  state = playChess(state, "alice", "g2", "g4");
  state = playChess(state, "bob", "d8", "h4");
  assert.equal(state.status, "completed");
  assert.equal(state.winnerId, "bob");
});

test("chess supports castling, en passant, and an underpromotion", () => {
  let castle = createChess(players);
  for (const [user, from, to] of [["alice", "e2", "e4"], ["bob", "e7", "e5"], ["alice", "g1", "f3"], ["bob", "b8", "c6"], ["alice", "f1", "e2"], ["bob", "g8", "f6"], ["alice", "e1", "g1"]] as const) castle = playChess(castle, user, from, to);
  assert.equal(chessPieces(castle).g1?.type, "k");
  assert.equal(chessPieces(castle).f1?.type, "r");

  let passant = createChess(players);
  for (const [user, from, to] of [["alice", "e2", "e4"], ["bob", "a7", "a6"], ["alice", "e4", "e5"], ["bob", "d7", "d5"], ["alice", "e5", "d6"]] as const) passant = playChess(passant, user, from, to);
  assert.equal(chessPieces(passant).d5, undefined);
  assert.equal(chessPieces(passant).d6?.type, "p");

  let promotion = createChess(players);
  for (const [user, from, to, piece] of [["alice", "a2", "a4", undefined], ["bob", "h7", "h5", undefined], ["alice", "a4", "a5", undefined], ["bob", "h5", "h4", undefined], ["alice", "a5", "a6", undefined], ["bob", "h4", "h3", undefined], ["alice", "a6", "b7", undefined], ["bob", "h3", "g2", undefined], ["alice", "b7", "a8", "n"]] as const) promotion = playChess(promotion, user, from, to, piece);
  assert.equal(chessPieces(promotion).a8?.type, "n");
});

test("Russian checkers exposes mandatory captures", () => {
  const state = createCheckers(players);
  const board = Array.from({ length: 64 }, () => null) as typeof state.board;
  board[42] = "w";
  board[33] = "b";
  const custom = { ...state, board };
  assert.deepEqual(legalCheckersMoves(custom, "alice"), [{ from: 42, to: 24, capture: 33 }]);
});

test("Russian checkers keeps the turn through a multi-capture and flying kings may land beyond a capture", () => {
  const initial = createCheckers(players);
  const board = Array.from({ length: 64 }, () => null) as typeof initial.board;
  board[42] = "w";
  board[33] = "b";
  board[17] = "b";
  let state = { ...initial, board };
  state = playCheckers(state, "alice", 42, 24);
  assert.equal(state.forcedFrom, 24);
  assert.equal(state.turnUserId, "alice");
  state = playCheckers(state, "alice", 24, 10);
  assert.equal(state.board[10], "w");

  const kingBoard = Array.from({ length: 64 }, () => null) as typeof initial.board;
  kingBoard[44] = "W";
  kingBoard[35] = "b";
  const destinations = legalCheckersMoves({ ...initial, board: kingBoard }, "alice").map((move) => move.to);
  assert.deepEqual(destinations, [26, 17, 8]);
});

test("Russian checkers declares a draw after the third repeated position", () => {
  const initial = createCheckers(players);
  const board = Array.from({ length: 64 }, () => null) as typeof initial.board;
  board[56] = "W";
  board[3] = "B";
  let state = { ...initial, board, positionCounts: {} };
  for (let cycle = 0; cycle < 2; cycle += 1) {
    state = playCheckers(state, "alice", 56, 49);
    state = playCheckers(state, "bob", 3, 10);
    state = playCheckers(state, "alice", 49, 56);
    state = playCheckers(state, "bob", 10, 3);
  }
  state = playCheckers(state, "alice", 56, 49);
  assert.equal(state.status, "completed");
  assert.equal(state.drawReason, "threefold-repetition");
});

test("sea battle generates a valid non-touching classic fleet and keeps turn after hit", () => {
  const fleetA = generateFleet(seed(31));
  const fleetB = generateFleet(seed(71));
  assert.equal(validateFleet(fleetA), true);
  assert.equal(validateFleet(fleetB), true);
  let state = createSeaBattle(players);
  state = readySeaBattle(state, "alice", fleetA);
  state = readySeaBattle(state, "bob", fleetB);
  state = fireSeaBattle(state, "alice", fleetB[0]![0]!, { alice: fleetA, bob: fleetB });
  assert.equal(state.turnUserId, "alice");
  assert.equal(validateFleet([[0, 1, 2, 3], [11, 12, 13], [20, 21, 22], [30, 31], [40, 41], [50, 51], [60], [70], [80], [90]]), false);
});

test("sea battle changes turn on a miss and completes after all twenty hits", () => {
  const fleetA = generateFleet(seed(19));
  const fleetB = generateFleet(seed(29));
  const fleets = { alice: fleetA, bob: fleetB };
  let state = readySeaBattle(readySeaBattle(createSeaBattle(players), "alice", fleetA), "bob", fleetB);
  const miss = Array.from({ length: 100 }, (_, cell) => cell).find((cell) => !fleetB.flat().includes(cell))!;
  state = fireSeaBattle(state, "alice", miss, fleets);
  assert.equal(state.turnUserId, "bob");
  const bobMiss = Array.from({ length: 100 }, (_, cell) => cell).find((cell) => !fleetA.flat().includes(cell))!;
  state = fireSeaBattle(state, "bob", bobMiss, fleets);
  for (const cell of fleetB.flat()) state = fireSeaBattle(state, "alice", cell, fleets);
  assert.equal(state.winnerId, "alice");
  assert.deepEqual(state.revealedFleets?.bob, fleetB);
});

function seed(initial: number) {
  let value = initial >>> 0;
  return () => {
    value = (value * 1_664_525 + 1_013_904_223) >>> 0;
    return value / 0x1_0000_0000;
  };
}

test("pool simulation is deterministic and keeps every ball on the table or pocketed", () => {
  const state = createPool(players);
  const first = playPool(state, "alice", { angle: 0, power: 0.8 });
  const second = playPool(state, "alice", { angle: 0, power: 0.8 });
  assert.deepEqual(first.balls, second.balls);
  assert.ok(first.balls.every((ball) => ball.pocketed || (ball.x >= 0.07 && ball.x <= 0.93 && ball.y >= 0.07 && ball.y <= 0.43)));
  const frames = tracePoolShot(state.balls, 0, 0.8);
  assert.ok(frames.length > 2);
  assert.deepEqual(frames.at(-1), first.balls);
});

test("pool awards an early eight ball to the opponent", () => {
  const initial = createPool(players);
  const balls = initial.balls.map((ball) => ({ ...ball, pocketed: ball.id !== 0 && ball.id !== 8 }));
  const cue = balls.find((ball) => ball.id === 0)!;
  const eight = balls.find((ball) => ball.id === 8)!;
  Object.assign(cue, { x: 0.76, y: 0.07, pocketed: false });
  Object.assign(eight, { x: 0.89, y: 0.055, pocketed: false });
  const result = playPool({ ...initial, balls, breakShot: false }, "alice", { angle: 0, power: 0.7 });
  assert.equal(result.winnerId, "bob");
});

test("stored game state validation fails closed", () => {
  assert.throws(() => parseGameState({ version: 1, kind: "chess", players, board: [] }));
});
