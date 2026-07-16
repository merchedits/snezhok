#!/usr/bin/env node
import { lstat, readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function planReleaseRetention(entries, { keep = 5, minimumAgeDays = 30, now = Date.now(), currentVersion = null } = {}) {
  if (!Number.isInteger(keep) || keep < 2) throw new Error("keep must be an integer of at least 2");
  if (!Number.isInteger(minimumAgeDays) || minimumAgeDays < 1) throw new Error("minimumAgeDays must be a positive integer");
  const ranked = [...entries].sort((left, right) =>
    right.versionCode - left.versionCode || right.modifiedAt - left.modifiedAt || right.version.localeCompare(left.version),
  );
  const protectedVersions = new Set(ranked.slice(0, keep).map((entry) => entry.version));
  if (currentVersion) protectedVersions.add(currentVersion);
  const cutoff = now - minimumAgeDays * 86_400_000;
  return ranked.filter((entry) => !protectedVersions.has(entry.version) && entry.modifiedAt < cutoff);
}

export async function inspectReleases(releasesDirectory) {
  const names = await readdir(releasesDirectory);
  const entries = [];
  for (const name of names) {
    const match = /^snezhok-(\d+\.\d+\.\d+)\.json$/.exec(name);
    if (!match) continue;
    const version = match[1];
    const manifestPath = path.join(releasesDirectory, name);
    const apkPath = path.join(releasesDirectory, `snezhok-${version}.apk`);
    try {
      const [manifest, manifestStat, apkStat] = await Promise.all([
        readFile(manifestPath, "utf8").then(JSON.parse),
        lstat(manifestPath),
        lstat(apkPath),
      ]);
      if (!manifestStat.isFile() || manifestStat.isSymbolicLink() || !apkStat.isFile() || apkStat.isSymbolicLink()) continue;
      if (manifest.version !== version || !Number.isSafeInteger(manifest.versionCode)) continue;
      entries.push({ version, versionCode: manifest.versionCode, modifiedAt: Math.max(manifestStat.mtimeMs, apkStat.mtimeMs), manifestPath, apkPath });
    } catch {
      // Incomplete pairs are intentionally left for manual inspection.
    }
  }
  return entries;
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const apply = args.has("--apply");
  const platformRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const releasesDirectory = path.resolve(process.env.RELEASES_ROOT ?? path.join(platformRoot, "releases"));
  if (releasesDirectory === path.parse(releasesDirectory).root) throw new Error("refusing to use a filesystem root as RELEASES_ROOT");
  const keep = Number(process.env.RELEASE_KEEP_COUNT ?? 5);
  const minimumAgeDays = Number(process.env.RELEASE_RETENTION_DAYS ?? 30);
  const currentManifest = await readFile(path.join(releasesDirectory, "android-current.json"), "utf8").then(JSON.parse);
  const entries = await inspectReleases(releasesDirectory);
  const removals = planReleaseRetention(entries, { keep, minimumAgeDays, currentVersion: currentManifest.version });
  for (const entry of removals) {
    if (apply) {
      await rm(entry.apkPath);
      await rm(entry.manifestPath);
      process.stdout.write(`removed Snezhok ${entry.version} (versionCode ${entry.versionCode})\n`);
    } else {
      process.stdout.write(`would remove Snezhok ${entry.version} (versionCode ${entry.versionCode})\n`);
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`release retention failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
