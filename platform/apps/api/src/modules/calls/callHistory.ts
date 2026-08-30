import type { DbClient } from "../../db/pool.js";
import { newId } from "../../lib/ids.js";
import { getMessageById } from "../messages/service.js";
import { storeEvent } from "../realtime/events.js";
import { allocateMessageSequence, streamRecipients } from "../streams/access.js";

export interface EndedCallHistoryInput { id: string; streamId: string; streamKind: "conversation" | "channel"; answeredBy: string[]; endedAt: Date }

export function callHistoryText(answered: boolean, durationMs: number): string {
  return JSON.stringify({ v: 1, type: "call", status: answered ? "completed" : "missed", durationMs: Math.max(0, Math.round(durationMs)) });
}

export async function recordCallHistoryMessage(client: DbClient, input: EndedCallHistoryInput): Promise<void> {
  if (input.streamKind !== "conversation") return;
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`call-history:${input.id}`]);
  const call = (await client.query<{ started_by: string; started_at: Date }>("SELECT started_by,started_at FROM call_sessions WHERE id=$1", [input.id])).rows[0];
  if (!call) return;
  const duplicate = await client.query("SELECT 1 FROM messages WHERE sender_id=$1 AND client_id=$2", [call.started_by, input.id]);
  if (duplicate.rowCount) return;
  const sequence = await allocateMessageSequence({ streamKind: input.streamKind, streamId: input.streamId }, client);
  const messageId = newId();
  await client.query(
    "INSERT INTO messages(id,stream_kind,stream_id,sequence,sender_id,client_id,kind,text,silent) VALUES ($1,$2,$3,$4,$5,$6,'system',$7,true)",
    [messageId, input.streamKind, input.streamId, sequence, call.started_by, input.id, callHistoryText(input.answeredBy.length > 0, input.endedAt.getTime() - call.started_at.getTime())],
  );
  const recipients = await streamRecipients({ streamKind: input.streamKind, streamId: input.streamId, serverId: null }, client);
  const message = await getMessageById(client, messageId);
  await storeEvent(client, recipients, "message:created", message);
}
