import assert from "node:assert/strict";
import test from "node:test";

import { bindBootstrapInvalidations, bootstrapInvalidationEvents } from "./realtimeInvalidation";

test("every durable server, membership and relationship mutation invalidates bootstrap", () => {
  const handlers = new Map<string, (...args: unknown[]) => void>();
  let refreshes = 0;
  bindBootstrapInvalidations({ on: (event, listener) => handlers.set(event, listener) }, () => { refreshes += 1; });

  assert.deepEqual([...handlers.keys()], [...bootstrapInvalidationEvents]);
  for (const handler of handlers.values()) handler({});
  assert.equal(refreshes, bootstrapInvalidationEvents.length);
});
