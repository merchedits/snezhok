import assert from "node:assert/strict";
import test from "node:test";

import { closeRemoteDeviceSession } from "./sessionClosure";

test("device closure unregisters push before revoking the server session", async () => {
  const requests: Array<{ url: string; init: RequestInit }> = [];
  await closeRemoteDeviceSession("https://example.test/api", "token", "device id", async (url, init) => {
    requests.push({ url, init });
    return new Response(null, { status: 204 });
  });
  assert.deepEqual(requests.map((request) => [request.init.method, request.url]), [
    ["DELETE", "https://example.test/api/notifications/devices/device%20id"],
    ["POST", "https://example.test/api/auth/logout"],
  ]);
  assert.equal((requests[0]?.init.headers as Record<string, string>).Authorization, "Bearer token");
});

test("push cleanup failure never prevents session revocation", async () => {
  const methods: string[] = [];
  await assert.rejects(closeRemoteDeviceSession("https://example.test", "token", "device", async (_url, init) => {
    methods.push(String(init.method));
    if (init.method === "DELETE") throw new Error("offline");
    return new Response(null, { status: 204 });
  }), /offline/);
  assert.deepEqual(methods, ["DELETE", "POST"]);
});
