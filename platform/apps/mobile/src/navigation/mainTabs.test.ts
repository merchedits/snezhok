import assert from "node:assert/strict";
import test from "node:test";

import { MAIN_TABS, mainTabDirection, mainTabIndex, mainTabTransition, visitMainTab } from "./mainTabs";

test("bottom tabs have a stable Telegram-style horizontal order", () => {
  assert.deepEqual(MAIN_TABS, ["chats", "servers", "profile", "settings"]);
  assert.equal(mainTabIndex("settings"), 3);
  assert.equal(mainTabDirection("chats", "settings"), 1);
  assert.equal(mainTabDirection("settings", "servers"), -1);
  assert.equal(mainTabDirection("profile", "profile"), 0);
});

test("a distant tab transition contains only its two endpoints", () => {
  assert.deepEqual(mainTabTransition("chats", "settings"), {
    from: "chats",
    to: "settings",
    direction: 1,
  });
  assert.deepEqual(mainTabTransition("settings", "servers"), {
    from: "settings",
    to: "servers",
    direction: -1,
  });
});

test("visited tabs are added lazily and preserve identity after repeat visits", () => {
  const initial = new Set<typeof MAIN_TABS[number]>(["chats"]);
  const visited = visitMainTab(initial, "settings");
  assert.deepEqual([...visited], ["chats", "settings"]);
  assert.equal(visitMainTab(visited, "settings"), visited);
});
