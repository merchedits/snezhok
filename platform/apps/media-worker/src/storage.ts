import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { constants } from "node:fs";
import { copyFile, mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { config } from "./config.js";

export const storageRoot = path.resolve(config.STORAGE_ROOT);

export function objectPath(storageKey: string) {
  const parts = storageKey.split("/");
  if (parts.length !== 3 || parts[0] !== "objects" || !/^[a-f0-9]{2}$/.test(parts[1] ?? "") || !/^[a-f0-9]{64}(?:-[a-f0-9-]{16,64})?$/.test(parts[2] ?? "")) {
    throw new Error("Invalid content-addressed storage key");
  }
  return path.join(storageRoot, ...parts);
}

export async function createJobDirectory(jobId: string) {
  const root = path.join(storageRoot, "worker-tmp");
  await mkdir(root, { recursive: true });
  return mkdtemp(path.join(root, `${jobId}-`));
}

export async function removeJobDirectory(directory: string) {
  await rm(directory, { force: true, recursive: true });
}

export async function commitOutput(source: string) {
  const sourceInfo = await stat(source);
  if (!sourceInfo.isFile() || sourceInfo.size <= 0) throw new Error("Media processor produced an empty or invalid output");
  if (sourceInfo.size > config.MAX_MEDIA_OUTPUT_BYTES) throw new Error("Media processor output exceeds its safety limit");
  const hash = createHash("sha256");
  await new Promise<void>((resolve, reject) => createReadStream(source).on("data", (chunk) => hash.update(chunk)).on("end", resolve).on("error", reject));
  const checksum = hash.digest("hex");
  const id = randomUUID();
  const storageKey = `objects/${checksum.slice(0, 2)}/${checksum}-${id}`;
  const target = objectPath(storageKey);
  await mkdir(path.dirname(target), { recursive: true });
  try { await copyFile(source, target, constants.COPYFILE_EXCL); } catch (error) {
    const exists = await stat(target).then((entry) => entry.isFile()).catch(() => false);
    if (!exists) throw error;
  }
  const info = await stat(target);
  if (!info.isFile() || info.size !== sourceInfo.size) throw new Error("Committed media output does not match the processed file");
  return { id, checksum, storageKey, bytes: info.size };
}

export async function removeCommittedOutput(storageKey: string) {
  await rm(objectPath(storageKey), { force: true });
}

export function hostHasCapacity() {
  const freeMb = os.freemem() / 1024 / 1024;
  const loadPerCpu = os.loadavg()[0]! / Math.max(1, os.cpus().length);
  return freeMb >= config.MIN_FREE_MEMORY_MB && loadPerCpu <= config.MAX_LOAD_PER_CPU;
}
