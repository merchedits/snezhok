import * as Crypto from "expo-crypto";

import { recordDiagnostic } from "../../diagnostics/diagnostics";
import {
  clearSessionIfCurrent,
  getRuntimeSession,
  getSessionGeneration,
  readSession,
  sessionOwnerId,
  writeSessionIfCurrent,
} from "../../lib/secureSession";
import { API_URL } from "./apiConfig";
import { SessionTransport } from "./sessionTransportCore";

export { fetchWithTimeout, SessionTransport } from "./sessionTransportCore";
export type { JsonRequestOptions, ResponseDecoder, SessionTransportDependencies } from "./sessionTransportCore";

export const sessionTransport = new SessionTransport({
  baseUrl: API_URL,
  fetch: globalThis.fetch.bind(globalThis),
  readSession,
  getRuntimeSession,
  getSessionGeneration,
  sessionOwnerId,
  clearSessionIfCurrent,
  writeSessionIfCurrent,
  randomUUID: Crypto.randomUUID,
  record: recordDiagnostic,
});
