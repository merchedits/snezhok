import * as MediaLibrary from "expo-media-library";

import type { Attachment, Message } from "@snezhok/contracts";

import { ensureAttachmentDownloaded } from "../../lib/attachmentDownloadManager";

export async function downloadSelectedAttachments(messages: readonly Message[]): Promise<number> {
  const attachments = uniqueAttachments(messages.flatMap((message) => message.attachments).filter((attachment) => attachment.status !== "processing" && attachment.status !== "failed"));
  const media = attachments.filter((attachment) => attachment.kind === "image" || attachment.kind === "video");
  if (media.length) {
    const permission = await MediaLibrary.requestPermissionsAsync(true, ["photo", "video"]);
    if (!permission.granted) throw new Error("MEDIA_LIBRARY_PERMISSION_REQUIRED");
  }
  for (const attachment of attachments) {
    const file = await ensureAttachmentDownloaded({ id: attachment.id, url: attachment.originalUrl ?? attachment.url, filename: attachment.filename, bytes: attachment.bytes });
    if (attachment.kind === "image" || attachment.kind === "video") await MediaLibrary.Asset.create(file.uri);
  }
  return attachments.length;
}

function uniqueAttachments(attachments: readonly Attachment[]): Attachment[] {
  return [...new Map(attachments.map((attachment) => [attachment.id, attachment])).values()];
}
