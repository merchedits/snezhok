import assert from "node:assert/strict";
import test from "node:test";

import { EXPIRING_GAME_TYPES, inactiveGameCutoff, INACTIVE_GAME_TTL_MS } from "./activityExpiry.js";

test("unfinished mini-games expire exactly 24 hours after their latest activity", () => {
  const now = Date.UTC(2026, 7, 30, 12);
  assert.equal(INACTIVE_GAME_TTL_MS, 86_400_000);
  assert.equal(inactiveGameCutoff(now).getTime(), now - 86_400_000);
  assert.deepEqual(EXPIRING_GAME_TYPES, ["tic-tac-toe", "chess", "checkers", "sea-battle", "pool"]);
});
