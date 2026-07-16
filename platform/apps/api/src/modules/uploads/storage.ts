import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { constants } from "node:fs";
import { copyFile, mkdir, open, readdir, rename, rm, stat } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { Transform, type Readable } from "node:stream";
import path from "node:path";
import { fileTypeFromFile } from "file-type";
import { config } from "../../config.js";

export const uploadRoot = path.resolve(config.STORAGE_ROOT);
export const temporaryRoot = path.join(uploadRoot, "tmp");
export const objectRoot = path.join(uploadRoot, "objects");

export async function ensureStorage() {
  await Promise.all([mkdir(temporaryRoot, { recursive: true }), mkdir(objectRoot, { recursive: true })]);
}

export async function initializeTemporary(key: string) {
  const handle = await open(tempPath(key), "wx");
  await handle.close();
}

export function tempPath(key: string) { return path.join(temporaryRoot, safeKey(key)); }
export function objectPath(key: string) { return path.join(uploadRoot, ...key.split("/").map(safeKey)); }

export async function appendChunk(key: string, offset: number, data: Buffer) {
  const target = tempPath(key);
  const handle = await open(target, "r+").catch(() => open(target, "w+"));
  try { await handle.write(data, 0, data.length, offset); } finally { await handle.close(); }
}

export async function writeWholeUpload(key: string, body: Readable, expectedBytes: number) {
  let receivedBytes = 0;
  const meter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      receivedBytes += chunk.length;
      if (receivedBytes > expectedBytes) return callback(new Error("Upload exceeds its declared size"));
      callback(null, chunk);
    },
  });
  await pipeline(body, meter, createWriteStream(tempPath(key), { flags: "w" }));
  if (receivedBytes !== expectedBytes) throw new Error(`Expected ${expectedBytes} bytes but received ${receivedBytes}`);
  return receivedBytes;
}

export async function finalizeObject(key: string) {
  const object = await stageObject(key);
  await rm(tempPath(key), { force: true });
  return object;
}

export async function stageObject(key: string) {
  const source = tempPath(key);
  const info = await stat(source);
  const hash = createHash("sha256");
  await new Promise<void>((resolve, reject) => createReadStream(source).on("data", (chunk) => hash.update(chunk)).on("end", resolve).on("error", reject));
  const checksum = hash.digest("hex");
  // The checksum remains the database deduplication key, while each staging
  // attempt owns a distinct immutable object generation. This prevents a
  // collector deleting an old checksum path after a concurrent upload has
  // already reused it for a new blob row.
  const generation = createHash("sha256").update(safeKey(key)).digest("hex").slice(0, 24);
  const storageKey = `objects/${checksum.slice(0, 2)}/${checksum}-${generation}`;
  const target = objectPath(storageKey);
  await mkdir(path.dirname(target), { recursive: true });
  try { await copyFile(source, target, constants.COPYFILE_EXCL); } catch (error) {
    const exists = await stat(target).then(() => true).catch(() => false);
    if (!exists) throw error;
  }
  const targetInfo = await stat(target);
  if (!targetInfo.isFile() || targetInfo.size !== info.size) throw new Error("Existing content-addressed object does not match the staged upload");
  const detected = await fileTypeFromFile(target);
  return { checksum, storageKey, bytes: info.size, detectedMimeType: detected?.mime ?? "application/octet-stream" };
}

export async function detectTemporaryMimeType(key: string): Promise<string> {
  return (await fileTypeFromFile(tempPath(key)))?.mime ?? "application/octet-stream";
}

export async function removeTemporary(key: string) { await rm(tempPath(key), { force: true }); }
export async function removeObject(key: string) { await rm(objectPath(key), { force: true }); }

/** Removes temp files that have no live database session after a generous grace period. */
export async function removeUntrackedTemporaryFiles(activeKeys: Set<string>, olderThanMs: number, limit = 500): Promise<number> {
  const entries = await readdir(temporaryRoot, { withFileTypes: true }).catch(() => []);
  let removed = 0;
  for (const entry of entries) {
    if (removed >= limit || !entry.isFile() || activeKeys.has(entry.name)) continue;
    let target: string;
    try { target = tempPath(entry.name); } catch { continue; }
    const info = await stat(target).catch(() => null);
    if (!info || info.mtimeMs > olderThanMs) continue;
    await rm(target, { force: true });
    removed += 1;
  }
  return removed;
}

/**
 * Removes abandoned generation-keyed objects after a generous grace period.
 * Immutable objects with a database row are always retained. Symlinks and
 * malformed paths are ignored rather than followed.
 */
export async function removeUntrackedObjectFiles(activeKeys: Set<string>, olderThanMs: number, limit = 500): Promise<number> {
  const pending = [objectRoot];
  let removed = 0;
  while (pending.length && removed < limit) {
    const directory = pending.pop()!;
    for (const entry of await readdir(directory, { withFileTypes: true }).catch(() => [])) {
      if (removed >= limit) break;
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        pending.push(target);
        continue;
      }
      if (!entry.isFile()) continue;
      const storageKey = path.relative(uploadRoot, target).split(path.sep).join("/");
      try {
        if (objectPath(storageKey) !== target || activeKeys.has(storageKey)) continue;
      } catch {
        continue;
      }
      const info = await stat(target).catch(() => null);
      if (!info || info.mtimeMs > olderThanMs) continue;
      await rm(target, { force: true });
      removed += 1;
    }
  }
  return removed;
}

function safeKey(value: string) {
  if (value === "." || value === ".." || !/^[a-zA-Z0-9._-]+$/.test(value)) throw new Error("Unsafe storage key");
  return value;
}
