import assert from "node:assert/strict";
import test from "node:test";

import { defaultRuntimeCapabilities, productRuntimeCapabilities, productServerProjection } from "./appState";

test("optional product capabilities fail closed before authenticated bootstrap", () => {
  assert.deepEqual({
    uploads: defaultRuntimeCapabilities.uploads,
    calls: defaultRuntimeCapabilities.calls,
    activities: defaultRuntimeCapabilities.activities,
    servers: defaultRuntimeCapabilities.servers,
  }, { uploads: false, calls: false, activities: false, servers: false });
  assert.equal(defaultRuntimeCapabilities.revision, 0);
  assert.equal(defaultRuntimeCapabilities.maxUploadBytes, 0);
});

test("dormant servers are excluded from cached and runtime projections", () => {
  assert.deepEqual(productServerProjection({
    servers: [{ id: "server" }] as never,
    categories: [{ id: "category" }] as never,
    channels: [{ id: "channel" }] as never,
  }), { servers: [], categories: [], channels: [] });
  assert.equal(productRuntimeCapabilities({ ...defaultRuntimeCapabilities, servers: true }).servers, false);
});
