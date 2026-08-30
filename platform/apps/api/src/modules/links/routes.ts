import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { requireAuth } from "../auth/middleware.js";
import { fetchSafeLinkPreview, type LinkPreviewResult } from "./safePreview.js";

const querySchema = z.object({ url: z.string().url().max(2_048) }).strict();
const cache = new Map<string, { expiresAt: number; value: LinkPreviewResult }>();

export async function linkRoutes(app: FastifyInstance) {
  app.get("/links/preview", { preHandler: requireAuth, config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (request, reply) => {
    const { url } = querySchema.parse(request.query);
    const cached = cache.get(url);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    try {
      const value = await fetchSafeLinkPreview(url);
      if (cache.size >= 500) cache.delete(cache.keys().next().value!);
      cache.set(url, { expiresAt: Date.now() + 10 * 60_000, value });
      return value;
    } catch { return reply.status(422).send({ code: "LINK_PREVIEW_UNAVAILABLE", message: "Link preview is unavailable" }); }
  });
}
