import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { installErrorHandler } from "./errors.js";

test("malformed JSON remains a client error", async () => {
  const app = Fastify();
  installErrorHandler(app);
  app.post("/json", async () => ({ ok: true }));

  const response = await app.inject({
    method: "POST",
    url: "/json",
    headers: { "content-type": "application/json" },
    payload: "{",
  });

  assert.equal(response.statusCode, 400);
  assert.deepEqual(response.json(), { code: "INVALID_JSON", message: "Request body must be valid JSON" });
  await app.close();
});
