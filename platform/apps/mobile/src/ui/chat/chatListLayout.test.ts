import assert from "node:assert/strict";
import test from "node:test";

import { shouldFillChatListViewport } from "./chatListLayout";

test("populated chat lists do not insert a flexible viewport spacer", () => {
  assert.equal(shouldFillChatListViewport(1), false);
  assert.equal(shouldFillChatListViewport(3), false);
  assert.equal(shouldFillChatListViewport(100), false);
});

test("the empty chat state can fill the remaining viewport", () => {
  assert.equal(shouldFillChatListViewport(0), true);
});
