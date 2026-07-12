import type { FastifyInstance } from "fastify";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { config } from "../../config.js";
import { notFound } from "../../lib/errors.js";
import { requireAuth } from "../auth/middleware.js";

async function androidRelease() {
  if (!config.ANDROID_APK_PATH) throw notFound("Android release is not configured");
  const absolutePath = path.resolve(config.ANDROID_APK_PATH);
  const info = await stat(absolutePath).catch(() => null);
  if (!info?.isFile()) throw notFound("Android release is not available");
  return { absolutePath, info };
}

export async function clientRoutes(app: FastifyInstance) {
  app.get("/client/android/manifest", { preHandler: requireAuth }, async () => {
    const { absolutePath, info } = await androidRelease();
    const hash = createHash("sha256");
    await new Promise<void>((resolve, reject) => {
      createReadStream(absolutePath)
        .on("data", (chunk) => hash.update(chunk))
        .on("end", resolve)
        .on("error", reject);
    });
    return {
      applicationId: "xyz.merchedits.snezhok",
      version: "3.0.0",
      versionCode: 1,
      bytes: info.size,
      sha256: hash.digest("hex"),
      downloadUrl: `${config.PUBLIC_API_PREFIX}/client/android`,
    };
  });

  app.get("/client/android", { preHandler: requireAuth }, async (_request, reply) => {
    const { absolutePath, info } = await androidRelease();
    reply
      .type("application/vnd.android.package-archive")
      .header("Content-Disposition", 'attachment; filename="snezhok-3.0.0.apk"')
      .header("Content-Length", info.size)
      .header("Cache-Control", "private, no-store");
    return reply.send(createReadStream(absolutePath));
  });
}
