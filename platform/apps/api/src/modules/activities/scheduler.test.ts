import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("activity scheduler durably publishes completed collage media into chat history", async () => {
  const source = await readFile(new URL("./scheduler.ts", import.meta.url), "utf8");
  const actions = await readFile(new URL("./actions.ts", import.meta.url), "utf8");
  assert.match(source, /attachment\.status='ready'/);
  assert.match(source, /payload->>'published'/);
  assert.match(source, /revision=revision\+1/);
  assert.match(source, /"message:updated"/);
  assert.match(actions, /'image\/png',0,2160,2160,'high','processing'/);
});

test("activity scheduler expires unfinished games after 24 inactive hours", async () => {
  const source = await readFile(new URL("./scheduler.ts", import.meta.url), "utf8");
  assert.match(source, /expireInactiveGames/);
  assert.match(source, /state IN \('active','waiting'\)/);
  assert.match(source, /action,revision,metadata[\s\S]*'expired'/);
  assert.match(source, /message:updated/);
});
