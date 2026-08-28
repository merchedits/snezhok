import assert from "node:assert/strict";
import test from "node:test";
import { createCheckers, createChess, playChess } from "@snezhok/game-engine";
import { materialAdvantage, poolShotFromPull } from "./gamePresentation";

const players: [string, string] = ["alice", "bob"];

test("material advantage follows chess and checkers piece values", () => {
  let chess = createChess(players);
  chess = playChess(chess, "alice", "e2", "e4");
  chess = playChess(chess, "bob", "e7", "e5");
  chess = playChess(chess, "alice", "d1", "h5");
  chess = playChess(chess, "bob", "b8", "c6");
  chess = playChess(chess, "alice", "h5", "e5");
  chess = playChess(chess, "bob", "c6", "e5");
  assert.equal(materialAdvantage(chess, 1), 8);
  assert.equal(materialAdvantage(chess, 0), 0);

  const checkers = createCheckers(players);
  const board = checkers.board.map((piece) => piece === "b" ? null : piece);
  assert.equal(materialAdvantage({ ...checkers, board }, 0), 12);
});

test("pool pull gesture aims opposite the drag and scales power continuously", () => {
  const weak = poolShotFromPull({ x: 0.25, y: 0.25 }, { x: 0.30, y: 0.25 });
  const strong = poolShotFromPull({ x: 0.25, y: 0.25 }, { x: 0.49, y: 0.25 });
  assert.ok(weak && strong);
  assert.ok(Math.abs(Math.abs(weak.angle) - Math.PI) < 1e-9);
  assert.ok(strong.power > weak.power);
  assert.equal(strong.power, 1);
  assert.equal(poolShotFromPull({ x: 0.25, y: 0.25 }, { x: 0.251, y: 0.25 }), null);
});
