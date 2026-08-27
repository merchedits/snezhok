import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("cooperative games extend the durable activity type constraint", async () => {
  const sql = await readFile(new URL("../../migrations/0027_cooperative_games.sql", import.meta.url), "utf8");
  for (const game of ["tic-tac-toe", "chess", "checkers", "sea-battle", "pool"]) assert.match(sql, new RegExp(`'${game}'`));
  assert.match(sql, /DROP CONSTRAINT IF EXISTS cooperative_activities_type_check/);
  assert.match(sql, /ADD CONSTRAINT cooperative_activities_type_check/);
});
