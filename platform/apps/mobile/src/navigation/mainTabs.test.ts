import assert from "node:assert/strict";
import test from "node:test";

import { MAIN_TABS, mainTabDirection, mainTabIndex, mainTabTransition } from "./mainTabs";

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
