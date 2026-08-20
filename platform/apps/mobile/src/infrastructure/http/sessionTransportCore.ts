import { authResponseSchema } from "@snezhok/contracts";

import type { AuthTokens } from "../../types";
import { ApiError } from "../../lib/apiError";

export type JsonRequestOptions = Omit<RequestInit, "body"> & {
  body?: BodyInit | object;
  authenticated?: boolean;
  timeoutMs?: number;
};

export interface ResponseDecoder {
  parse(input: unknown): unknown;
}

type DiagnosticRecorder = (
  level: "debug" | "info" | "warn" | "error",
  category: "network",
  message: string,
  context?: Record<string, unknown>,
  durationMs?: number,
) => void;

export interface SessionTransportDependencies {
  baseUrl: string;
  fetch: typeof fetch;
  readSession: () => Promise<AuthTokens | null>;
  getRuntimeSession: () => AuthTokens | null;
  getSessionGeneration: () => number;
  sessionOwnerId: (tokens: AuthTokens | null) => string | null;
  clearSessionIfCurrent: (expectedGeneration: number) => Promise<boolean>;
  writeSessionIfCurrent: (tokens: AuthTokens, expectedGeneration: number) => Promise<boolean>;
  randomUUID: () => string;
  record: DiagnosticRecorder;
}

const REQUEST_TIMEOUT_MS = 20_000;
const UPLOAD_CONTROL_TIMEOUT_MS = 60_000;

export async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = REQUEST_TIMEOUT_MS,
  fetchImplementation: typeof fetch = globalThis.fetch.bind(globalThis),
): Promise<Response> {
  const controller = new AbortController();
  const onAbort = () => controller.abort(init.signal?.reason);
  if (init.signal) {
    if (init.signal.aborted) controller.abort(init.signal.reason);
    else init.signal.addEventListener("abort", onAbort, { once: true });
  }
  const timer = setTimeout(() => controller.abort(new Error("Request timed out")), timeoutMs);
  try {
    return await fetchImplementation(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    init.signal?.removeEventListener("abort", onAbort);
  }
}

/** Pure transport core. Expo and React Native dependencies are supplied by its adapter. */
export class SessionTransport {
  private refreshInFlight: Promise<AuthTokens | null> | null = null;

  constructor(private readonly dependencies: SessionTransportDependencies) {}

  async request<T>(path: string, options: JsonRequestOptions = {}, decoder?: ResponseDecoder, retry = true): Promise<T> {
    const startedAt = performance.now();
    const requestId = this.dependencies.randomUUID();
    const { authenticated: authenticationOption, body: rawBody, timeoutMs, ...fetchOptions } = options;
    const authenticated = authenticationOption !== false;
    const session = authenticated ? await this.dependencies.readSession() : null;
    const requestOwnerId = this.dependencies.sessionOwnerId(session);
    const isForm = typeof FormData !== "undefined" && rawBody instanceof FormData;
    const isBlob = typeof Blob !== "undefined" && rawBody instanceof Blob;
    const isRaw = typeof rawBody === "string" || isForm || isBlob || rawBody instanceof ArrayBuffer;
    const headers = new Headers(fetchOptions.headers);
    headers.set("Accept", "application/json");
    headers.set("X-Request-ID", requestId);
    if (!isRaw && rawBody !== undefined) headers.set("Content-Type", "application/json");
    if (session?.accessToken) headers.set("Authorization", `Bearer ${session.accessToken}`);

    const init: RequestInit = { ...fetchOptions, headers };
    if (rawBody !== undefined) init.body = isRaw ? rawBody as BodyInit : JSON.stringify(rawBody);
    let response: Response;
    try {
      response = await fetchWithTimeout(
        `${this.dependencies.baseUrl}${path}`,
        init,
        timeoutMs ?? (path.startsWith("/uploads/") ? UPLOAD_CONTROL_TIMEOUT_MS : REQUEST_TIMEOUT_MS),
        this.dependencies.fetch,
      );
    } catch (error) {
      this.dependencies.record("error", "network", "API request could not reach the server", {
        path: path.split("?", 1)[0], method: init.method ?? "GET", requestId, error,
      }, performance.now() - startedAt);
      throw error;
    }

    this.dependencies.record(response.ok ? "debug" : response.status >= 500 ? "error" : "warn", "network", "API request completed", {
      path: path.split("?", 1)[0],
      method: init.method ?? "GET",
      status: response.status,
      requestId: response.headers.get("x-request-id") ?? requestId,
    }, performance.now() - startedAt);

    if (authenticated && requestOwnerId !== this.dependencies.sessionOwnerId(this.dependencies.getRuntimeSession())) {
      throw new ApiError("Account changed while the request was in progress", 401, "SESSION_CHANGED");
    }
    if (response.status === 401 && authenticated && retry && await this.refresh()) {
      return this.request<T>(path, options, decoder, false);
    }
    if (!response.ok) {
      const payload = await response.json().catch(() => null) as { code?: string; message?: string; details?: Record<string, string[]> } | null;
      throw new ApiError(payload?.message ?? `Request failed (${response.status})`, response.status, payload?.code, payload?.details);
    }
    if (response.status === 204) return undefined as T;
    const payload: unknown = await response.json();
    if (!decoder) return payload as T;
    try {
      return decoder.parse(payload) as T;
    } catch (error) {
      this.dependencies.record("error", "network", "API response failed runtime validation", {
        path: path.split("?", 1)[0],
        method: init.method ?? "GET",
        status: response.status,
        requestId: response.headers.get("x-request-id") ?? requestId,
        errorName: error instanceof Error ? error.name : "UnknownError",
      }, performance.now() - startedAt);
      throw new ApiError("Server returned an incompatible response", 502, "INVALID_SERVER_RESPONSE");
    }
  }

  /** Refreshes the active session for native adapters that cannot use fetch. */
  async refreshSession(): Promise<boolean> {
    return Boolean(await this.refresh());
  }

  private async refresh(): Promise<AuthTokens | null> {
    if (this.refreshInFlight) return this.refreshInFlight;
    this.refreshInFlight = (async () => {
      const sessionGeneration = this.dependencies.getSessionGeneration();
      const current = await this.dependencies.readSession();
      if (!current) return null;
      const response = await fetchWithTimeout(`${this.dependencies.baseUrl}/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken: current.refreshToken }),
      }, REQUEST_TIMEOUT_MS, this.dependencies.fetch);
      if (!response.ok) {
        if (response.status === 400 || response.status === 401 || response.status === 403) {
          await this.dependencies.clearSessionIfCurrent(sessionGeneration);
        }
        return null;
      }
      let result;
      try {
        result = authResponseSchema.parse(await response.json());
      } catch {
        throw new ApiError("Server returned an incompatible refresh response", 502, "INVALID_SERVER_RESPONSE");
      }
      const tokens: AuthTokens = {
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        expiresAt: Date.now() + result.expiresIn * 1_000,
        ...(current.ownerId ? { ownerId: current.ownerId } : {}),
      };
      return await this.dependencies.writeSessionIfCurrent(tokens, sessionGeneration) ? tokens : null;
    })().finally(() => { this.refreshInFlight = null; });
    return this.refreshInFlight;
  }
}
