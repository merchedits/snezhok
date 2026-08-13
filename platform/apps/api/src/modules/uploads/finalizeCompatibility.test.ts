import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import { assertEmptyFinalizeBody, uploadRoutes } from "./routes.js";

test("Android zero-byte form finalize requests reach upload authentication", async () => {
  const app = Fastify();
  app.decorateRequest("auth");
  await app.register(cookie);
  await app.register(uploadRoutes);
  const response = await app.inject({
    method: "POST",
    url: "/uploads/00000000-0000-4000-8000-000000000000/complete",
    headers: { "content-type": "application/x-www-form-urlencoded", "content-length": "0" },
  });
  assert.equal(response.statusCode, 401);
  await app.close();
});

test("upload finalize accepts only empty compatibility bodies", () => {
  for (const body of [undefined, null, Buffer.alloc(0), "", {}]) assert.doesNotThrow(() => assertEmptyFinalizeBody(body));
  for (const body of [Buffer.from("x"), "x", { unexpected: true }, []]) {
    assert.throws(() => assertEmptyFinalizeBody(body), /completion body must be empty/i);
  }
});
