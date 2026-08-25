import assert from "node:assert/strict";
import test from "node:test";

import { canTerminateActivity, distinctActivityCopy, isPersistentCollection, persistentCollectionStatus } from "./activityPresentation";

test("movie and idea collections stay persistent instead of behaving like disposable games", () => {
  assert.equal(isPersistentCollection("movie-list"), true);
  assert.equal(isPersistentCollection("ideas-jar"), true);
  assert.equal(isPersistentCollection("color-hunt"), false);
  assert.equal(canTerminateActivity("movie-list", "active"), false);
  assert.equal(canTerminateActivity("question", "active"), true);
  assert.equal(canTerminateActivity("question", "completed"), false);
  assert.equal(persistentCollectionStatus("ru"), "Общий список");
});

test("an activity card never repeats its label as a second title", () => {
  assert.equal(distinctActivityCopy("Наши фильмы", "Наши фильмы"), "");
  assert.equal(distinctActivityCopy("Movie List", " movie   list "), "");
  assert.equal(distinctActivityCopy("Вопрос для двоих", "Каким был бы идеальный день?"), "Каким был бы идеальный день?");
});
