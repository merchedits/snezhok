import assert from "node:assert/strict";
import test from "node:test";
import { hashOpaqueToken } from "./service.js";

test("opaque token hashing is deterministic without retaining the token", () => {
  const token = "a-sensitive-refresh-token";
  const hash = hashOpaqueToken(token);
  assert.equal(hash, hashOpaqueToken(token));
  assert.notEqual(hash, token);
  assert.match(hash, /^[0-9a-f]{64}$/);
});

test("public registration cannot derive administration from a claimed username", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) => readFile(new URL("service.ts", import.meta.url), "utf8"));
  assert.doesNotMatch(source, /configuredAdminUsername|ADMIN_USERNAMES/);
  assert.match(source, /VALUES \(\$1,\$2,\$3,\$3,\$4,false\)/);
});
