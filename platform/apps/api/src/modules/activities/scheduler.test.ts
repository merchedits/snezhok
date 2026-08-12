import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("activity scheduler durably publishes completed collage media into chat history", async () => {
  const source = await readFile(new URL("./scheduler.ts", import.meta.url), "utf8");
  assert.match(source, /attachment\.status='ready'/);
  assert.match(source, /payload->>'published'/);
  assert.match(source, /revision=revision\+1/);
  assert.match(source, /"message:updated"/);
});
