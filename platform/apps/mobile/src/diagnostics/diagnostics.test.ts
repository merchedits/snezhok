import assert from "node:assert/strict";
import test from "node:test";
import { sanitizeDiagnosticValue } from "./redaction";

test("diagnostic text removes credentials and personal identifiers", () => {
  const sanitized = sanitizeDiagnosticValue("Bearer abc.def user@example.com 7a840dc2-96ac-4cce-a276-5ffbbfe15225 https://merchedits.xyz/chat/api/v1/messages?token=secret");
  assert.equal(sanitized.includes("abc.def"), false);
  assert.equal(sanitized.includes("user@example.com"), false);
  assert.equal(sanitized.includes("7a840dc2"), false);
  assert.equal(sanitized.includes("merchedits.xyz"), false);
});
