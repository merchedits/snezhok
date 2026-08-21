import assert from "node:assert/strict";
import test from "node:test";
import { blitzPrompts, drawWords, initialActivityConfiguration, questionCatalog, questionPool, songPrompts, tinyQuests } from "./prompts.js";

test("random questions exclude romantic and adult packs without mutual consent", () => {
  const safeCount = Object.entries(questionCatalog).filter(([category]) => category !== "romantic" && category !== "nsfw").reduce((total, [, prompts]) => total + prompts.length, 0);
  const fullCount = Object.values(questionCatalog).reduce((total, prompts) => total + prompts.length, 0);
  assert.equal(questionPool("random", false).length, safeCount);
  assert.equal(questionPool("random", true).length, fullCount);
  assert.equal(questionPool("romantic", false).length, questionCatalog.romantic?.length, "the service applies the explicit-category consent gate before prompt selection");
});

test("cooperative prompt catalog is broad, bilingual, and free from duplicate entries", () => {
  assert.ok(Object.values(questionCatalog).every((prompts) => prompts.length >= 30));
  assert.ok(blitzPrompts.length >= 70);
  assert.ok(tinyQuests.length >= 70);
  assert.ok(songPrompts.length >= 45);
  assert.ok(drawWords.length >= 100);

  const localizedCollections = [...Object.values(questionCatalog), tinyQuests, songPrompts, drawWords];
  for (const collection of localizedCollections) {
    assert.ok(collection.every((item) => item.ru.trim() && item.en.trim()));
    assert.equal(new Set(collection.map((item) => item.ru.toLocaleLowerCase("ru"))).size, collection.length);
    assert.equal(new Set(collection.map((item) => item.en.toLocaleLowerCase("en"))).size, collection.length);
  }
  assert.equal(new Set(blitzPrompts.map((prompt) => prompt.id)).size, blitzPrompts.length);
});

test("recent cooperative prompts are not immediately repeated while fresh choices remain", () => {
  const recentQuestion = questionCatalog.silly![0]!;
  const question = initialActivityConfiguration("question", { category: "silly" }, ["one", "two"], [{ prompt: recentQuestion }]);
  assert.notDeepEqual(question.config.prompt, recentQuestion);

  const recentQuest = tinyQuests[0]!;
  const quest = initialActivityConfiguration("tiny-quest", {}, ["one", "two"], [{ prompt: recentQuest }]);
  assert.notDeepEqual(quest.config.prompt, recentQuest);

  const recentBlitz = blitzPrompts.slice(0, 8);
  const blitz = initialActivityConfiguration("blitz", { count: 8 }, ["one", "two"], [{ prompts: recentBlitz }]);
  const ids = new Set((blitz.config.prompts as typeof blitzPrompts).map((prompt) => prompt.id));
  assert.ok(recentBlitz.every((prompt) => !ids.has(prompt.id)));
});
