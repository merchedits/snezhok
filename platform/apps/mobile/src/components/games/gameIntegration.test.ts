import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { GAME_KINDS } from "@snezhok/game-engine";
import { gameCatalog } from "./gameCatalog";

test("every durable game has one bilingual launcher identity", () => {
  assert.deepEqual(Object.keys(gameCatalog).sort(), [...GAME_KINDS].sort());
  assert.equal(new Set(Object.values(gameCatalog).map((game) => game.ru)).size, GAME_KINDS.length);
  assert.ok(Object.values(gameCatalog).every((game) => game.ru.trim() && game.en.trim()));
});

test("completed games rematch inside the existing activity sheet", async () => {
  const experience = await readFile(new URL("./GameExperience.tsx", import.meta.url), "utf8");
  const modal = await readFile(new URL("../CooperativeActivityModal.tsx", import.meta.url), "utf8");
  assert.match(experience, /run\("game-rematch"\)/);
  assert.match(experience, /Играть ещё/);
  assert.match(modal, /isGameKind\(activity\.type\)/);
});
