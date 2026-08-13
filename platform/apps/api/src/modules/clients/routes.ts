import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { config } from "../../config.js";
import { AppError, notFound } from "../../lib/errors.js";

const releaseManifestSchema = z.object({
  applicationId: z.literal("xyz.merchedits.snezhok"),
  version: z.string().regex(/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/),
  versionCode: z.number().int().positive(),
  minimumVersionCode: z.number().int().positive().default(1),
  mandatory: z.boolean().default(false),
  bytes: z.number().int().positive(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/i).transform((value) => value.toLowerCase()),
  signingCertificateSha256: z.string().regex(/^[a-f0-9]{64}$/i).transform((value) => value.toLowerCase()),
  publishedAt: z.string().datetime(),
  sourceRevision: z.string().regex(/^[a-f0-9]{40}$/).transform((value) => value.toLowerCase()),
  architectures: z.array(z.enum(["arm64-v8a", "armeabi-v7a"])).min(1).max(2)
    .refine((values) => new Set(values).size === values.length, "Architectures must be unique"),
  minSdk: z.number().int().min(21),
  targetSdk: z.number().int().min(21),
  releaseNotes: z.array(z.string().trim().min(1).max(240)).max(20).default([]),
}).superRefine((value, context) => {
  if (value.minimumVersionCode > value.versionCode) {
    context.addIssue({ code: "custom", path: ["minimumVersionCode"], message: "Minimum version cannot exceed the release version" });
  }
  if (value.targetSdk < value.minSdk) {
    context.addIssue({ code: "custom", path: ["targetSdk"], message: "Target SDK cannot be lower than min SDK" });
  }
});

type AndroidReleaseManifest = z.infer<typeof releaseManifestSchema>;
let cachedRelease: { apkModified: number; manifestModified: number; manifest: AndroidReleaseManifest; absolutePath: string } | null = null;

async function androidRelease() {
  if (!config.ANDROID_APK_PATH || !config.ANDROID_RELEASE_MANIFEST_PATH) throw notFound("Android release is not configured");
  const absolutePath = path.resolve(config.ANDROID_APK_PATH);
  const manifestPath = path.resolve(config.ANDROID_RELEASE_MANIFEST_PATH);
  const [apkInfo, manifestInfo] = await Promise.all([stat(absolutePath).catch(() => null), stat(manifestPath).catch(() => null)]);
  if (!apkInfo?.isFile() || !manifestInfo?.isFile()) throw notFound("Android release is not available");
  if (cachedRelease?.apkModified === apkInfo.mtimeMs && cachedRelease.manifestModified === manifestInfo.mtimeMs) {
    return { ...cachedRelease, info: apkInfo };
  }
  let rawManifest: unknown;
  try {
    rawManifest = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch {
    throw new AppError(503, "INVALID_RELEASE", "Android release metadata is invalid");
  }
  const parsed = releaseManifestSchema.safeParse(rawManifest);
  if (!parsed.success) throw new AppError(503, "INVALID_RELEASE", "Android release metadata is invalid");
  if (parsed.data.bytes !== apkInfo.size) throw new AppError(503, "INVALID_RELEASE", "Android release size does not match its manifest");
  cachedRelease = { apkModified: apkInfo.mtimeMs, manifestModified: manifestInfo.mtimeMs, manifest: parsed.data, absolutePath };
  return { ...cachedRelease, info: apkInfo };
}

export function parseAndroidReleaseManifest(value: unknown): AndroidReleaseManifest {
  return releaseManifestSchema.parse(value);
}

export async function clientRoutes(app: FastifyInstance) {
  app.get("/client/android/manifest", async (_request, reply) => {
    const { manifest } = await androidRelease();
    return reply.header("Cache-Control", "public, max-age=60, must-revalidate").send({
      ...manifest,
      downloadUrl: `${config.PUBLIC_API_PREFIX}/client/android`,
      downloadMirrors: [
        `${config.PUBLIC_API_PREFIX}/client/android/origin`,
        githubReleaseDownloadUrl(manifest.version),
      ],
    });
  });

  const sendAndroidRelease = async (request: FastifyRequest, reply: FastifyReply) => {
    const { absolutePath, info, manifest } = await androidRelease();
    const etag = `"sha256-${manifest.sha256}"`;
    if (request.headers["if-none-match"] === etag) return reply.status(304).send();
    reply
      .type("application/vnd.android.package-archive")
      .header("Content-Disposition", `attachment; filename="snezhok-${manifest.version}.apk"`)
      .header("Cache-Control", "public, max-age=300, must-revalidate")
      .header("Accept-Ranges", "bytes")
      .header("ETag", etag);
    const range = parseSingleRange(request.headers.range, info.size);
    if (range === "invalid") return reply.status(416).header("Content-Range", `bytes */${info.size}`).send();
    if (range) {
      reply.status(206).header("Content-Range", `bytes ${range.start}-${range.end}/${info.size}`).header("Content-Length", range.end - range.start + 1);
      return reply.send(createReadStream(absolutePath, range));
    }
    return reply.header("Content-Length", info.size).send(createReadStream(absolutePath));
  };
  app.get("/client/android", sendAndroidRelease);
  app.get("/client/android/origin", sendAndroidRelease);
}

export function githubReleaseDownloadUrl(version: string): string {
  const encodedVersion = encodeURIComponent(version);
  return `https://github.com/merchedits/snezhok/releases/download/android-v${encodedVersion}/snezhok-${encodedVersion}.apk`;
}

export function parseSingleRange(header: string | undefined, totalBytes: number): { start: number; end: number } | "invalid" | null {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || totalBytes <= 0) return "invalid";
  const startText = match[1] ?? ""; const endText = match[2] ?? "";
  if (!startText && !endText) return "invalid";
  let start: number; let end: number;
  if (!startText) {
    const suffix = Number(endText);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return "invalid";
    start = Math.max(0, totalBytes - suffix); end = totalBytes - 1;
  } else {
    start = Number(startText); end = endText ? Number(endText) : totalBytes - 1;
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || start >= totalBytes) return "invalid";
  return { start, end: Math.min(end, totalBytes - 1) };
}
