import assert from "node:assert/strict";
import test from "node:test";
import { registerSchema } from "@snezhok/contracts";

test("registration requires and normalizes an email without an invite", () => {
  const parsed = registerSchema.parse({
    email: "  User@Example.COM ",
    username: "Snow.Friend",
    password: "long-enough-password",
  });

  assert.equal(parsed.email, "user@example.com");
  assert.equal(parsed.username, "snow.friend");
  assert.equal("inviteCode" in parsed, false);
  assert.throws(() => registerSchema.parse({ username: "snow", password: "long-enough-password" }));
});
