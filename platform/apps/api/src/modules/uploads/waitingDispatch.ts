import type { Attachment, MessageKind } from "@snezhok/contracts";

export type AttachmentDispatchKind = Exclude<MessageKind, "system" | "text">;

export interface WaitingUploadDeclaration {
  uploadId: string;
  filename: string;
  mimeType: string;
  bytes: number;
  quality: Attachment["quality"];
  kind: Attachment["kind"];
  stripLocation: boolean;
  purpose: "standard" | "voice" | "video-note";
}

export function validateWaitingDispatchShape(kind: AttachmentDispatchKind, uploads: readonly WaitingUploadDeclaration[]): void {
  if (uploads.length < 1 || uploads.length > 10) throw new Error("Attachment groups must contain between one and ten uploads");
  if (new Set(uploads.map((upload) => upload.uploadId)).size !== uploads.length) throw new Error("Upload identifiers must be unique");
  if (kind === "voice") {
    if (uploads.length !== 1 || uploads[0]?.purpose !== "voice" || !["audio", "video"].includes(uploads[0]?.kind ?? "")) {
      throw new Error("Voice messages require one voice audio or video upload");
    }
    return;
  }
  if (kind === "video-note") {
    if (uploads.length !== 1 || uploads[0]?.purpose !== "video-note" || uploads[0]?.kind !== "video") {
      throw new Error("Video notes require one video-note upload");
    }
    return;
  }
  if (uploads.some((upload) => upload.purpose !== "standard")) throw new Error("Media and file groups require standard uploads");
  if (kind === "media" && uploads.some((upload) => upload.kind !== "image" && upload.kind !== "video")) {
    throw new Error("Media messages only accept image and video uploads");
  }
}

export const promoteReadyWaitingDispatchSql = `UPDATE scheduled_messages scheduled
 SET status='pending',scheduled_for=now(),expires_at=NULL,last_error=NULL,updated_at=now()
 WHERE scheduled.status='waiting' AND $1::uuid=ANY(scheduled.attachment_ids)
   AND scheduled.expires_at>now()
   AND NOT EXISTS (
     SELECT 1 FROM unnest(scheduled.attachment_ids) expected(id)
     LEFT JOIN attachments attachment ON attachment.id=expected.id AND attachment.owner_id=scheduled.user_id
       AND attachment.status IN ('ready','processing')
     WHERE attachment.id IS NULL
   )`;

export const recoverWaitingDispatchesSql = `UPDATE scheduled_messages scheduled
 SET status='pending',scheduled_for=now(),expires_at=NULL,last_error=NULL,updated_at=now()
 WHERE scheduled.status='waiting' AND scheduled.expires_at>now()
   AND NOT EXISTS (
     SELECT 1 FROM unnest(scheduled.attachment_ids) expected(id)
     LEFT JOIN attachments attachment ON attachment.id=expected.id AND attachment.owner_id=scheduled.user_id
       AND attachment.status IN ('ready','processing')
     WHERE attachment.id IS NULL
   )`;

export const expireWaitingDispatchesSql = `UPDATE scheduled_messages
 SET status='cancelled',last_error='Attachment upload expired',updated_at=now()
 WHERE status='waiting' AND expires_at<=now()`;

export const cancelWaitingDispatchForUploadSql = `UPDATE scheduled_messages
 SET status='cancelled',last_error='Attachment upload cancelled',updated_at=now()
 WHERE status='waiting' AND $1::uuid=ANY(attachment_ids)`;
