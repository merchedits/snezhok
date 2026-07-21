import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./api.js";

const id = "550e8400-e29b-41d4-a716-446655440000";

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
}

describe("API boundary", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("uses the concrete stream and pin mutation routes", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ message: { id } }));
    vi.stubGlobal("fetch", fetchMock);

    await api.pin(id, false);

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/api\/v1\/messages\/.*\/pin$/);
    expect(init.method).toBe("PUT");
    expect(JSON.parse(String(init.body))).toEqual({ pinned: true });
    expect(init.credentials).toBe("include");
  });

  it("uploads resumable raw chunks using server offsets", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ uploadId: id, upload: { id, offset: 0, chunkBytes: 4, expiresAt: Date.now() + 60_000 } }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(jsonResponse({ attachment: { id, filename: "note.txt" } }));
    vi.stubGlobal("fetch", fetchMock);

    await api.upload({
      file: new File(["testing"], "note.txt", { type: "text/plain" }),
      kind: "document",
      quality: "original",
      stripLocation: true,
    });

    expect(fetchMock.mock.calls[0]?.[0]).toMatch(/\/uploads\/init$/);
    const firstChunk = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(firstChunk[0]).toMatch(/\/uploads\/.*\/chunk$/);
    expect(firstChunk[1].method).toBe("PATCH");
    expect(new Headers(firstChunk[1].headers).get("upload-offset")).toBe("0");
    expect(new Headers(firstChunk[1].headers).get("Content-Type")).toBe("application/offset+octet-stream");
    expect(fetchMock.mock.calls.at(-1)?.[0]).toMatch(/\/complete$/);
  });

  it("uses live account, unblock, and server-member management routes", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ success: true }))
      .mockResolvedValueOnce(jsonResponse({ success: true }))
      .mockResolvedValueOnce(jsonResponse({ members: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await api.deleteAccount("secret");
    await api.unblockUser(id);
    await api.serverMembers(id);

    expect(fetchMock.mock.calls[0]?.[0]).toMatch(/\/users\/me$/);
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: "DELETE" });
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({ password: "secret" });
    expect(fetchMock.mock.calls[1]?.[0]).toMatch(/\/friends\/.*\/block$/);
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ method: "DELETE" });
    expect(fetchMock.mock.calls[2]?.[0]).toMatch(/\/servers\/.*\/members$/);
  });

  it("notifies the server when leaving or ending a call", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await api.leaveCall(id);
    await api.endCall(id);

    expect(fetchMock.mock.calls[0]?.[0]).toMatch(/\/calls\/.*\/leave$/);
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: "POST" });
    expect(fetchMock.mock.calls[1]?.[0]).toMatch(/\/calls\/.*\/end$/);
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ method: "POST" });
  });

  it("coalesces concurrent unauthorized requests behind one refresh", async () => {
    let protectedCalls = 0;
    let refreshCalls = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/auth/refresh")) {
        refreshCalls += 1;
        return jsonResponse({ success: true });
      }
      protectedCalls += 1;
      return protectedCalls <= 2 ? jsonResponse({ message: "expired" }, 401) : jsonResponse({ user: { id } });
    });
    vi.stubGlobal("fetch", fetchMock);

    await Promise.all([api.me(), api.me()]);

    expect(refreshCalls).toBe(1);
    expect(protectedCalls).toBe(4);
  });

  it("invalidates an in-flight refresh before logout can be followed by a stale retry", async () => {
    let releaseRefresh!: (response: Response) => void;
    const refresh = new Promise<Response>((resolve) => { releaseRefresh = resolve; });
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/auth/refresh")) return refresh;
      if (url.endsWith("/auth/logout")) return Promise.resolve(new Response(null, { status: 204 }));
      return Promise.resolve(jsonResponse({ message: "expired" }, 401));
    });
    vi.stubGlobal("fetch", fetchMock);

    const request = api.me();
    await vi.waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/auth/refresh"))).toBe(true));
    await api.logout();
    releaseRefresh(jsonResponse({ success: true }));

    await expect(request).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/auth/me"))).toHaveLength(1);
  });
});
