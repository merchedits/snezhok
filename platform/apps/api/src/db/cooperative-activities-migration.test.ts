import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("cooperative activities preserve one durable chat anchor and idempotent commands", async () => {
  const sql = await readFile(new URL("../../migrations/0018_cooperative_activities.sql", import.meta.url), "utf8");
  for (const invariant of [
    "CREATE TABLE cooperative_activities",
    "anchor_message_id uuid UNIQUE",
    "UNIQUE (created_by, client_id)",
    "CREATE TABLE cooperative_activity_participants",
    "CREATE TABLE cooperative_activity_entries",
    "CREATE TABLE cooperative_activity_attachments",
    "CREATE TABLE cooperative_activity_commands",
    "PRIMARY KEY (activity_id, user_id, client_id)",
    "cooperative_activities_reveal_idx",
    "cooperative_activities_living_list_idx",
  ]) assert.match(sql, new RegExp(invariant.replace(/[()]/g, "\\$&")));
});
