import assert from "node:assert/strict";
import test from "node:test";

import type { AuthTokens } from "../../types";
import { SessionTransport, type SessionTransportDependencies } from "./sessionTransportCore";

test("concurrent 401 responses share exactly one refresh and retry with the rotated session", async () => {
  let session: AuthTokens | null = tokens("old-access", "old-refresh");
  let generation = 0;
  let refreshCalls = 0;
  const authenticatedHeaders: string[] = [];

  const fetchImplementation = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/auth/refresh")) {
      refreshCalls += 1;
      await Promise.resolve();
      return jsonResponse({
        accessToken: "new-access",
        refreshToken: "new-refresh",
        expiresIn: 900,
        user: {
          id: "00000000-0000-4000-8000-000000000010",
          username: "tester",
          displayName: "Tester",
          avatarUrl: null,
          avatarColor: "#6437F5",
          bio: "",
          statusText: "",
          presence: "online",
          lastSeenAt: 0,
        },
      });
    }
    const authorization = new Headers(init?.headers).get("authorization") ?? "";
    authenticatedHeaders.push(authorization);
    if (authorization === "Bearer old-access") return jsonResponse({ code: "UNAUTHORIZED" }, 401);
    return jsonResponse({ ok: true, url });
  };

  const transport = new SessionTransport(dependencies({
    fetch: fetchImplementation as typeof fetch,
    readSession: async () => session,
    getRuntimeSession: () => session,
    getSessionGeneration: () => generation,
    clearSessionIfCurrent: async (expected) => {
      if (expected !== generation) return false;
      session = null;
      generation += 1;
      return true;
    },
    writeSessionIfCurrent: async (next, expected) => {
      if (expected !== generation) return false;
      session = next;
      generation += 1;
      return true;
    },
  }));

  const [first, second] = await Promise.all([
    transport.request<{ ok: true }>("/first"),
    transport.request<{ ok: true }>("/second"),
  ]);

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(refreshCalls, 1);
  assert.equal(session?.accessToken, "new-access");
  assert.equal(authenticatedHeaders.filter((value) => value === "Bearer old-access").length, 2);
  assert.equal(authenticatedHeaders.filter((value) => value === "Bearer new-access").length, 2);
});

test("a late authenticated response cannot cross an account generation", async () => {
  let session: AuthTokens | null = tokens("first-access", "first-refresh", "first-user");
  let releaseResponse!: () => void;
  const responseGate = new Promise<void>((resolve) => { releaseResponse = resolve; });
  const transport = new SessionTransport(dependencies({
    fetch: (async () => {
      await responseGate;
      return jsonResponse({ ok: true });
    }) as typeof fetch,
    readSession: async () => session,
    getRuntimeSession: () => session,
  }));

  const request = transport.request("/account-bound");
  await Promise.resolve();
  session = tokens("second-access", "second-refresh", "second-user");
  releaseResponse();

  await assert.rejects(request, (error: unknown) => {
    return error instanceof Error && "code" in error && error.code === "SESSION_CHANGED";
  });
});

test("runtime decoding contains an incompatible successful payload at the transport boundary", async () => {
  const session = tokens("access", "refresh");
  const transport = new SessionTransport(dependencies({
    fetch: (async () => jsonResponse({ value: "not-a-number" })) as typeof fetch,
    readSession: async () => session,
    getRuntimeSession: () => session,
  }));

  await assert.rejects(
    transport.request("/validated", {}, {
      parse(input) {
        const value = (input as { value?: unknown }).value;
        if (typeof value !== "number") throw new TypeError("invalid value");
        return { value };
      },
    }),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "INVALID_SERVER_RESPONSE",
  );
});

function tokens(accessToken: string, refreshToken: string, ownerId = "first-user"): AuthTokens {
  return { accessToken, refreshToken, ownerId, expiresAt: Date.now() + 60_000 };
}

function dependencies(overrides: Partial<SessionTransportDependencies>): SessionTransportDependencies {
  return {
    baseUrl: "https://example.test/api/v1",
    fetch: (async () => jsonResponse({ ok: true })) as typeof fetch,
    readSession: async () => null,
    getRuntimeSession: () => null,
    getSessionGeneration: () => 0,
    sessionOwnerId: (value) => value?.ownerId ?? null,
    clearSessionIfCurrent: async () => false,
    writeSessionIfCurrent: async () => false,
    randomUUID: () => "00000000-0000-4000-8000-000000000001",
    record: () => undefined,
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
