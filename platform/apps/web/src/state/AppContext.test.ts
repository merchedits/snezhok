import { describe, expect, it } from "vitest";
import type { Message } from "@snezhok/contracts";
import { mergeMessage } from "./appContextDomain.js";

describe("message reconciliation", () => {
  it("replaces an optimistic row when a page acknowledges its client id", () => {
    const optimistic = { id: "client-1", clientId: "client-1", sequence: 99, pending: true, text: "pending" } as Message;
    const saved = { ...optimistic, id: "server-1", sequence: 10, pending: false, text: "saved" } as Message;
    expect(mergeMessage([optimistic], saved)).toEqual([saved]);
  });
});
