import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

test("productivity migration persists drafts, folders and scheduled delivery", async () => {
  const sql = await readFile(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../migrations/0007_chat_productivity.sql"), "utf8");
  for (const invariant of ["CREATE TABLE chat_drafts", "CREATE TABLE chat_folders", "CREATE TABLE chat_folder_streams", "CREATE TABLE scheduled_messages", "ADD COLUMN silent", "scheduled_messages_due_idx"]) {
    assert.equal(sql.includes(invariant), true, invariant);
  }
});
