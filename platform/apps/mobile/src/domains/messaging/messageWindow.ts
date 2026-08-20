import type { Message } from "@snezhok/contracts";

import { boundedMessageWindow } from "./cachePolicy";
import { mergeMessages as mergeUnboundedMessages } from "./messageReconciliation";

export function mergeMessageWindow(existing: Message[], incoming: Message[]): Message[] {
  return boundedMessageWindow(mergeUnboundedMessages(existing, incoming));
}
