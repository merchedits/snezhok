import assert from "node:assert/strict";
import test from "node:test";

import { AsyncValueCache } from "./asyncValueCache";

test("concurrent reads share one native load and subsequent reads stay in memory", async () => {
  const cache = new AsyncValueCache<string>();
  let loads = 0;
  const loader = async () => {
    loads += 1;
    return "session";
  };

  assert.deepEqual(await Promise.all([cache.read(loader), cache.read(loader)]), ["session", "session"]);
  assert.equal(await cache.read(loader), "session");
  assert.equal(loads, 1);
});

test("a mutation wins over a stale native read", async () => {
  const cache = new AsyncValueCache<string>();
  let resolveLoad: ((value: string | null) => void) | undefined;
  const loading = cache.read(() => new Promise((resolve) => { resolveLoad = resolve; }));

  cache.set(null);
  resolveLoad?.("expired-session");

  assert.equal(await loading, null);
  assert.equal(cache.peek(), null);
});
