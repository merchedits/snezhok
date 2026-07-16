import assert from "node:assert/strict";
import test from "node:test";
import { serverRoleUpdateSchema } from "@snezhok/contracts";

test("partial role updates do not materialize create-time defaults", () => {
  assert.deepEqual(serverRoleUpdateSchema.parse({ name: "Writers" }), { name: "Writers" });
  assert.deepEqual(serverRoleUpdateSchema.parse({ position: 4 }), { position: 4 });
});
