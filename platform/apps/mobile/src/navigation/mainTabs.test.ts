import assert from "node:assert/strict";
import test from "node:test";

import { ALL_MAIN_TABS, MAIN_TABS, mainTabDirection, mainTabIndex, mainTabTransition, visitMainTab } from "./mainTabs";

test("the current product shell hides the dormant Servers destination", () => {
  assert.deepEqual(ALL_MAIN_TABS, ["chats", "servers", "profile", "settings"]);
  assert.deepEqual(MAIN_TABS, ["chats", "profile", "settings"]);
  assert.equal(mainTabIndex("settings"), 2);
  assert.equal(mainTabDirection("chats", "settings"), 1);
  assert.equal(mainTabDirection("settings", "profile"), -1);
  assert.equal(mainTabDirection("profile", "profile"), 0);
});

test("a distant tab transition contains only its two endpoints", () => {
  assert.deepEqual(mainTabTransition("chats", "settings"), {
    from: "chats",
    to: "settings",
    direction: 1,
  });
  assert.deepEqual(mainTabTransition("settings", "profile"), {
    from: "settings",
    to: "profile",
    direction: -1,
  });
});

test("visited tabs are added lazily and preserve identity after repeat visits", () => {
  const initial = new Set<typeof MAIN_TABS[number]>(["chats"]);
  const visited = visitMainTab(initial, "settings");
  assert.deepEqual([...visited], ["chats", "settings"]);
  assert.equal(visitMainTab(visited, "settings"), visited);
});
