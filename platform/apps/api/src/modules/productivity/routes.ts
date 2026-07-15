import type { FastifyInstance } from "fastify";
import { messageCreateSchema } from "@snezhok/contracts";
import { z } from "zod";
import { pool, transaction } from "../../db/pool.js";
import { notFound } from "../../lib/errors.js";
import { newId } from "../../lib/ids.js";
import { requireAuth } from "../auth/middleware.js";
import { resolveStreamAccess } from "../streams/access.js";

const streamParams = z.object({ streamId: z.string().uuid() });
const folderParams = z.object({ id: z.string().uuid() });
const draftSchema = z.object({ text: z.string().max(16_000), replyToId: z.string().uuid().nullable().default(null) });
const streamReferenceSchema = z.object({ streamKind: z.enum(["conversation", "channel"]), streamId: z.string().uuid() });
const folderSchema = z.object({
  name: z.string().trim().min(1).max(40),
  includeArchived: z.boolean().default(false),
  streams: z.array(streamReferenceSchema).max(200).default([]),
});
const folderPatchSchema = folderSchema.partial().refine((input) => Object.keys(input).length > 0, { message: "At least one folder field is required" });
const scheduleSchema = messageCreateSchema.safeExtend({
  scheduledFor: z.number().int().positive(),
  silent: z.boolean().default(false),
}).superRefine((input, context) => {
  const delay = input.scheduledFor - Date.now();
  if (delay < 5_000) context.addIssue({ code: "custom", path: ["scheduledFor"], message: "Scheduled time must be at least five seconds from now" });
  if (delay > 366 * 24 * 60 * 60 * 1_000) context.addIssue({ code: "custom", path: ["scheduledFor"], message: "Scheduled time is too far in the future" });
});

export async function productivityRoutes(app: FastifyInstance) {
  app.get("/productivity", { preHandler: requireAuth }, async (request) => {
    const [drafts, folderRows, streamRows, scheduled] = await Promise.all([
      pool.query<{ stream_kind: "conversation" | "channel"; stream_id: string; text: string; reply_to_id: string | null; updated_at_ms: number }>(
        "SELECT stream_kind,stream_id,text,reply_to_id,(extract(epoch from updated_at)*1000)::bigint::float8 updated_at_ms FROM chat_drafts WHERE user_id=$1 ORDER BY updated_at DESC",
        [request.auth.id],
      ),
      pool.query<{ id: string; name: string; position: number; include_archived: boolean }>("SELECT id,name,position,include_archived FROM chat_folders WHERE user_id=$1 ORDER BY position,created_at", [request.auth.id]),
      pool.query<{ folder_id: string; stream_kind: "conversation" | "channel"; stream_id: string }>("SELECT cfs.folder_id,cfs.stream_kind,cfs.stream_id FROM chat_folder_streams cfs JOIN chat_folders cf ON cf.id=cfs.folder_id WHERE cf.user_id=$1 ORDER BY cfs.position", [request.auth.id]),
      pool.query<{ id: string; stream_kind: "conversation" | "channel"; stream_id: string; text: string; kind: string; silent: boolean; scheduled_for_ms: number }>(
        "SELECT id,stream_kind,stream_id,text,kind,silent,(extract(epoch from scheduled_for)*1000)::bigint::float8 scheduled_for_ms FROM scheduled_messages WHERE user_id=$1 AND status='pending' ORDER BY scheduled_for",
        [request.auth.id],
      ),
    ]);
    return {
      drafts: drafts.rows.map((row) => ({ streamKind: row.stream_kind, streamId: row.stream_id, text: row.text, replyToId: row.reply_to_id, updatedAt: Number(row.updated_at_ms) })),
      folders: folderRows.rows.map((folder) => ({
        id: folder.id,
        name: folder.name,
        position: folder.position,
        includeArchived: folder.include_archived,
        streams: streamRows.rows.filter((row) => row.folder_id === folder.id).map((row) => ({ streamKind: row.stream_kind, streamId: row.stream_id })),
      })),
      scheduled: scheduled.rows.map((row) => ({ id: row.id, streamKind: row.stream_kind, streamId: row.stream_id, text: row.text, kind: row.kind, silent: row.silent, scheduledFor: Number(row.scheduled_for_ms) })),
    };
  });

  app.put("/streams/:streamId/draft", { preHandler: requireAuth }, async (request) => {
    const { streamId } = streamParams.parse(request.params);
    const body = draftSchema.parse(request.body);
    const access = await resolveStreamAccess(request.auth.id, streamId);
    if (!body.text && !body.replyToId) {
      await pool.query("DELETE FROM chat_drafts WHERE user_id=$1 AND stream_kind=$2 AND stream_id=$3", [request.auth.id, access.streamKind, streamId]);
      return { draft: null };
    }
    await pool.query(
      `INSERT INTO chat_drafts(user_id,stream_kind,stream_id,text,reply_to_id) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT(user_id,stream_kind,stream_id) DO UPDATE SET text=EXCLUDED.text,reply_to_id=EXCLUDED.reply_to_id,updated_at=now()`,
      [request.auth.id, access.streamKind, streamId, body.text, body.replyToId],
    );
    return { draft: { streamKind: access.streamKind, streamId, ...body, updatedAt: Date.now() } };
  });

  app.delete("/streams/:streamId/draft", { preHandler: requireAuth }, async (request) => {
    const { streamId } = streamParams.parse(request.params);
    const access = await resolveStreamAccess(request.auth.id, streamId);
    await pool.query("DELETE FROM chat_drafts WHERE user_id=$1 AND stream_kind=$2 AND stream_id=$3", [request.auth.id, access.streamKind, streamId]);
    return { success: true };
  });

  app.post("/streams/:streamId/scheduled", { preHandler: requireAuth }, async (request, reply) => {
    const { streamId } = streamParams.parse(request.params);
    const body = scheduleSchema.parse(request.body);
    const access = await resolveStreamAccess(request.auth.id, streamId);
    const id = newId();
    const result = await pool.query<{ id: string; scheduled_for_ms: number }>(
      `INSERT INTO scheduled_messages(id,user_id,stream_kind,stream_id,client_id,kind,text,reply_to_id,attachment_ids,silent,scheduled_for)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,to_timestamp($11/1000.0))
       ON CONFLICT(user_id,client_id) DO UPDATE SET updated_at=scheduled_messages.updated_at
       RETURNING id,(extract(epoch from scheduled_for)*1000)::bigint::float8 scheduled_for_ms`,
      [id, request.auth.id, access.streamKind, streamId, body.clientId, body.kind, body.text, body.replyToId, body.attachmentIds, body.silent, body.scheduledFor],
    );
    return reply.status(201).send({ scheduled: { id: result.rows[0]!.id, streamKind: access.streamKind, streamId, kind: body.kind, text: body.text, silent: body.silent, scheduledFor: Number(result.rows[0]!.scheduled_for_ms) } });
  });

  app.delete("/scheduled/:id", { preHandler: requireAuth }, async (request) => {
    const { id } = folderParams.parse(request.params);
    const result = await pool.query("UPDATE scheduled_messages SET status='cancelled',updated_at=now() WHERE id=$1 AND user_id=$2 AND status='pending'", [id, request.auth.id]);
    if (!result.rowCount) throw notFound("Scheduled message not found");
    return { success: true };
  });

  app.post("/folders", { preHandler: requireAuth }, async (request, reply) => {
    const body = folderSchema.parse(request.body);
    const folder = await saveFolder(request.auth.id, newId(), body, true);
    return reply.status(201).send({ folder });
  });

  app.patch("/folders/:id", { preHandler: requireAuth }, async (request) => {
    const { id } = folderParams.parse(request.params);
    const body = folderPatchSchema.parse(request.body);
    const existing = (await pool.query<{ name: string; include_archived: boolean }>("SELECT name,include_archived FROM chat_folders WHERE id=$1 AND user_id=$2", [id, request.auth.id])).rows[0];
    if (!existing) throw notFound("Folder not found");
    const folder = await saveFolder(request.auth.id, id, {
      name: body.name ?? existing.name,
      includeArchived: body.includeArchived ?? existing.include_archived,
      ...(body.streams ? { streams: body.streams } : {}),
    }, false);
    return { folder };
  });

  app.delete("/folders/:id", { preHandler: requireAuth }, async (request) => {
    const { id } = folderParams.parse(request.params);
    const result = await pool.query("DELETE FROM chat_folders WHERE id=$1 AND user_id=$2", [id, request.auth.id]);
    if (!result.rowCount) throw notFound("Folder not found");
    return { success: true };
  });
}

async function saveFolder(userId: string, id: string, body: { name: string; includeArchived: boolean; streams?: Array<z.infer<typeof streamReferenceSchema>> }, insert: boolean) {
  return transaction(async (client) => {
    if (body.streams) {
      for (const stream of body.streams) {
        const access = await resolveStreamAccess(userId, stream.streamId, client);
        if (access.streamKind !== stream.streamKind) throw notFound("Folder stream not found");
      }
    }
    if (insert) {
      const position = Number((await client.query<{ position: number }>("SELECT coalesce(max(position),-1)+1 position FROM chat_folders WHERE user_id=$1", [userId])).rows[0]?.position ?? 0);
      await client.query("INSERT INTO chat_folders(id,user_id,name,position,include_archived) VALUES ($1,$2,$3,$4,$5)", [id, userId, body.name, position, body.includeArchived]);
    } else {
      await client.query("UPDATE chat_folders SET name=$3,include_archived=$4,updated_at=now() WHERE id=$1 AND user_id=$2", [id, userId, body.name, body.includeArchived]);
    }
    if (body.streams) {
      await client.query("DELETE FROM chat_folder_streams WHERE folder_id=$1", [id]);
      for (const [position, stream] of body.streams.entries()) await client.query("INSERT INTO chat_folder_streams(folder_id,stream_kind,stream_id,position) VALUES ($1,$2,$3,$4)", [id, stream.streamKind, stream.streamId, position]);
    }
    const folder = (await client.query<{ name: string; position: number; include_archived: boolean }>("SELECT name,position,include_archived FROM chat_folders WHERE id=$1", [id])).rows[0]!;
    const streams = (await client.query<{ stream_kind: "conversation" | "channel"; stream_id: string }>("SELECT stream_kind,stream_id FROM chat_folder_streams WHERE folder_id=$1 ORDER BY position", [id])).rows;
    return { id, name: folder.name, position: folder.position, includeArchived: folder.include_archived, streams: streams.map((stream) => ({ streamKind: stream.stream_kind, streamId: stream.stream_id })) };
  });
}
