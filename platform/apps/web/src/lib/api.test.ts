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
});
