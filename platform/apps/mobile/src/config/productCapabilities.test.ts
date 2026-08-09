import assert from "node:assert/strict";
import test from "node:test";

import {
  isUserVisibleStreamKind,
  notificationPreferenceTabs,
  productCapabilities,
  userVisibleGlobalPermissions,
} from "./productCapabilities";

test("server features remain implemented but are hidden from the current product", () => {
  assert.equal(productCapabilities.servers, false);
  assert.equal(isUserVisibleStreamKind("conversation"), true);
  assert.equal(isUserVisibleStreamKind("channel"), false);
  assert.deepEqual(notificationPreferenceTabs, ["global", "streams"]);
  assert.deepEqual(userVisibleGlobalPermissions, ["createGroups", "uploadFiles", "startCalls"]);
});
