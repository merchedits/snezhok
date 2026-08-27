import assert from "node:assert/strict";
import test from "node:test";
import { createGame, createTicTacToe, playTicTacToe, type GameState } from "@snezhok/game-engine";
import type { DbClient } from "../../../db/pool.js";
import type { ActivityRow } from "../activityModel.js";
import { mutateGame } from "./gameActions.js";

const players = ["00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002"] as const;

test("server game mutation uses the authoritative stored turn", async () => {
  const state = createGame("tic-tac-toe", players, players[0]);
  const client = fakeClient();
  const result = await mutateGame(client, row(state), players[0], "game-move", { cell: 4 });
  assert.equal(result.state, "active");
  assert.equal((result.result?.board as unknown[])[4], "x");
  await assert.rejects(() => mutateGame(client, row(state), players[1], "game-move", { cell: 4 }));
});

test("rematch waits for mutual consent and then clears terminal persistence", async () => {
  let state = createTicTacToe([players[0], players[1]]);
  state = playTicTacToe(state, players[0], 0);
  state = playTicTacToe(state, players[1], 3);
  state = playTicTacToe(state, players[0], 1);
  state = playTicTacToe(state, players[1], 4);
  state = playTicTacToe(state, players[0], 2);
  const client = fakeClient();
  const first = await mutateGame(client, row(state), players[0], "game-rematch", {});
  assert.equal(first.state, "completed");
  const second = await mutateGame(client, row(first.result as unknown as GameState), players[1], "game-rematch", {});
  assert.equal(second.state, "active");
  assert.equal(second.resetCompletedAt, true);
  assert.deepEqual((second.result as unknown as GameState).players, [players[1], players[0]]);
});

function row(state: GameState): ActivityRow {
  return {
    id: "00000000-0000-4000-8000-000000000010",
    conversation_id: "00000000-0000-4000-8000-000000000011",
    anchor_message_id: "00000000-0000-4000-8000-000000000012",
    created_by: players[0],
    type: state.kind,
    state: state.status === "completed" ? "completed" : "active",
    revision: "0",
    config: {},
    result: state as unknown as Record<string, unknown>,
  };
}

function fakeClient(): DbClient {
  return { query: async () => ({ rows: [], rowCount: 0 }) } as unknown as DbClient;
}
