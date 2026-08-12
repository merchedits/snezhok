import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Together history is a bounded projection of visible durable anchor messages", async () => {
  const source = await readFile(new URL("./service.ts", import.meta.url), "utf8");
  assert.match(source, /JOIN messages anchor ON anchor\.id=ca\.anchor_message_id/);
  assert.match(source, /anchor\.deleted_at IS NULL/);
  assert.match(source, /NOT EXISTS \(SELECT 1 FROM hidden_messages/);
  assert.match(source, /ca\.state IN \('completed','locked'\)/);
  assert.match(source, /ca\.type IN \('movie-list','ideas-jar','milestone'\)/);
  assert.match(source, /LIMIT 50/);
  assert.match(source, /getMessagesByIds\(client, anchors\.rows\.map/);
});
