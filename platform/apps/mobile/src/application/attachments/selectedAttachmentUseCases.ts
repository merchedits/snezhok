import type { Message } from "@snezhok/contracts";

import { downloadSelectedAttachments } from "../../infrastructure/media/selectedAttachmentDownloader";

export const selectedAttachmentUseCases = {
  download: (messages: readonly Message[]) => downloadSelectedAttachments(messages),
};
