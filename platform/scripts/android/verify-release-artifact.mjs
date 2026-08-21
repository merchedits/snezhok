#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import process from "node:process";
import { validateAndroidEvidence } from "../compliance/validate-android-evidence.mjs";

const FORBIDDEN_RELEASE_CLASSES = ["expo.modules.devlauncher", "expo.modules.devmenu"];
const REQUIRED_LEGAL_ASSETS = [
  "/assets/legal/LICENSE.txt",
  "/assets/legal/THIRD_PARTY_NOTICES.txt",
  "/assets/legal/android/ANDROID_THIRD_PARTY_NOTICES.txt",
  "/assets/legal/android/android-dependencies.json",
  "/assets/legal/android/snezhok-android.cdx.json",
];

export function parseArguments(values) {
  const result = {};
  for (let index = 0; index < values.length; index += 1) {
    const key = values[index];
    if (!key?.startsWith("--")) throw new Error(`unexpected argument: ${key}`);
    const value = values[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`missing value for ${key}`);
    result[key.slice(2)] = value;
    index += 1;
  }
  return result;
}

export function parseCertificateDigest(output) {
  const match = /Signer #1 certificate SHA-256 digest:\s*([0-9a-f:]+)/i.exec(output);
  return match?.[1].replaceAll(":", "").toLowerCase() ?? null;
}

export function resolveCertificateDigest(primaryOutput, certificateOutput = "") {
  return parseCertificateDigest(primaryOutput) ?? parseCertificateDigest(certificateOutput);
}

export function parseArchitectures(fileList) {
  return [...new Set([...fileList.matchAll(/^\/lib\/([^/\r\n]+)\/[^/\r\n]+/gm)].map((match) => match[1]))].sort();
}

export function validatePublicationManifest(manifest) {
  const failures = [];
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) return ["release manifest must be a JSON object"];
  if (manifest.applicationId !== "xyz.merchedits.snezhok") failures.push("manifest applicationId is invalid");
  if (typeof manifest.version !== "string" || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(manifest.version)) failures.push("manifest version is not semantic");
  if (!Number.isSafeInteger(manifest.versionCode) || manifest.versionCode < 1) failures.push("manifest versionCode must be a positive safe integer");
  if (!Number.isSafeInteger(manifest.minimumVersionCode) || manifest.minimumVersionCode < 1 || manifest.minimumVersionCode > manifest.versionCode) failures.push("manifest minimumVersionCode is invalid");
  if (typeof manifest.mandatory !== "boolean") failures.push("manifest mandatory must be boolean");
  if (!Number.isSafeInteger(manifest.bytes) || manifest.bytes < 1) failures.push("manifest bytes must be a positive safe integer");
  if (typeof manifest.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(manifest.sha256)) failures.push("manifest sha256 must be lowercase hexadecimal");
  if (typeof manifest.signingCertificateSha256 !== "string" || !/^[0-9a-f]{64}$/.test(manifest.signingCertificateSha256)) failures.push("manifest signingCertificateSha256 must be lowercase hexadecimal");
  if (typeof manifest.publishedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(manifest.publishedAt) || !Number.isFinite(Date.parse(manifest.publishedAt))) failures.push("manifest publishedAt must be a UTC ISO timestamp");
  if (typeof manifest.sourceRevision !== "string" || !/^[0-9a-f]{40}$/.test(manifest.sourceRevision)) failures.push("manifest sourceRevision must be a complete public Git commit ID");
  if (!Array.isArray(manifest.releaseNotes) || manifest.releaseNotes.length > 20 || manifest.releaseNotes.some((note) => typeof note !== "string" || note.trim().length < 1 || note.trim().length > 240)) failures.push("manifest releaseNotes are invalid");
  if (manifest.architectures !== undefined && (!Array.isArray(manifest.architectures) || manifest.architectures.length < 1 || manifest.architectures.some((abi) => typeof abi !== "string" || !/^[A-Za-z0-9_-]+$/.test(abi)))) failures.push("manifest architectures are invalid");
  if (manifest.minSdk !== undefined && (!Number.isSafeInteger(manifest.minSdk) || manifest.minSdk < 21)) failures.push("manifest minSdk is invalid");
  if (manifest.targetSdk !== undefined && (!Number.isSafeInteger(manifest.targetSdk) || manifest.targetSdk < 21 || (Number.isSafeInteger(manifest.minSdk) && manifest.targetSdk < manifest.minSdk))) failures.push("manifest targetSdk is invalid");
  return failures;
}

function findAndroidTool(name) {
  const suffix = process.platform === "win32" ? ".bat" : "";
  const roots = [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT].filter(Boolean);
  const candidates = [];
  for (const root of roots) {
    candidates.push(path.join(root, "cmdline-tools", "latest", "bin", `${name}${suffix}`));
    if (name === "apksigner") {
      const buildToolsRoot = path.join(root, "build-tools");
      const versions = process.env.ANDROID_BUILD_TOOLS_VERSION
        ? [process.env.ANDROID_BUILD_TOOLS_VERSION]
        : existsSync(buildToolsRoot)
          ? readdirSync(buildToolsRoot).sort((left, right) => right.localeCompare(left, undefined, { numeric: true }))
          : [];
      for (const version of versions) candidates.push(path.join(root, "build-tools", version, `${name}${suffix}`));
    }
  }
  for (const candidate of candidates) if (existsSync(candidate)) return candidate;
  const lookup = spawnSync(process.platform === "win32" ? "where.exe" : "which", [`${name}${suffix}`], { encoding: "utf8" });
  if (lookup.status === 0 && lookup.stdout.trim()) return lookup.stdout.trim().split(/\r?\n/)[0];
  throw new Error(`Android SDK tool was not found: ${name}`);
}

function run(tool, args, { includeStderr = false } = {}) {
  const result = process.platform === "win32"
    ? spawnSync(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", tool, ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
    : spawnSync(tool, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${path.basename(tool)} failed: ${(result.stderr || result.stdout).trim()}`);
  const stdout = result.stdout.trim();
  if (!includeStderr) return stdout;
  return [stdout, result.stderr.trim()].filter(Boolean).join("\n");
}

function equalSets(actual, expected) {
  return actual.length === expected.length && actual.every((value, index) => value === expected[index]);
}

async function sha256(file) {
  const hash = createHash("sha256");
  const handle = await import("node:fs").then(({ createReadStream }) => createReadStream(file));
  for await (const chunk of handle) hash.update(chunk);
  return hash.digest("hex");
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  if (!args.apk) throw new Error("usage: verify-release-artifact.mjs --apk FILE [--manifest FILE]");
  const apk = path.resolve(args.apk);
  const apkInfo = await stat(apk);
  if (!apkInfo.isFile()) throw new Error(`APK is not a regular file: ${apk}`);
  const manifest = args.manifest ? JSON.parse(await readFile(path.resolve(args.manifest), "utf8")) : null;
  if (manifest) {
    const manifestFailures = validatePublicationManifest(manifest);
    if (manifestFailures.length) throw new Error(`release manifest verification failed:\n- ${manifestFailures.join("\n- ")}`);
  }
  const previousManifest = args["previous-manifest"] ? JSON.parse(await readFile(path.resolve(args["previous-manifest"]), "utf8")) : null;
  if (previousManifest) {
    const previousFailures = validatePublicationManifest(previousManifest);
    if (previousFailures.length) throw new Error(`previous release manifest is invalid:\n- ${previousFailures.join("\n- ")}`);
    if (!manifest) throw new Error("--previous-manifest requires --manifest");
    if (manifest.versionCode <= previousManifest.versionCode) throw new Error(`versionCode ${manifest.versionCode} must exceed published versionCode ${previousManifest.versionCode}`);
    if (manifest.version === previousManifest.version) throw new Error(`version ${manifest.version} is already published`);
    if (manifest.applicationId !== previousManifest.applicationId) throw new Error("applicationId cannot change across an update");
    if (manifest.signingCertificateSha256 !== previousManifest.signingCertificateSha256) throw new Error("signing certificate cannot change across a sideloaded update");
    if (manifest.sourceRevision === previousManifest.sourceRevision) throw new Error("sourceRevision must change across a new release");
  }
  const expectedPackage = args.package ?? manifest?.applicationId ?? "xyz.merchedits.snezhok";
  const expectedVersion = args.version ?? manifest?.version;
  const expectedVersionCode = Number(args["version-code"] ?? manifest?.versionCode);
  const expectedArchitectures = String(args.architectures ?? manifest?.architectures?.join(",") ?? "arm64-v8a,armeabi-v7a").split(",").map((value) => value.trim()).filter(Boolean).sort();
  const expectedCertificate = String(args["certificate-sha256"] ?? manifest?.signingCertificateSha256 ?? process.env.SNEZHOK_EXPECTED_CERT_SHA256 ?? "").replaceAll(":", "").toLowerCase();

  const apkanalyzer = findAndroidTool("apkanalyzer");
  const apksigner = findAndroidTool("apksigner");
  const actualPackage = run(apkanalyzer, ["manifest", "application-id", apk]);
  const actualVersion = run(apkanalyzer, ["manifest", "version-name", apk]);
  const actualVersionCode = Number(run(apkanalyzer, ["manifest", "version-code", apk]));
  const actualMinSdk = Number(run(apkanalyzer, ["manifest", "min-sdk", apk]));
  const actualTargetSdk = Number(run(apkanalyzer, ["manifest", "target-sdk", apk]));
  const manifestXml = run(apkanalyzer, ["manifest", "print", apk]);
  const files = run(apkanalyzer, ["files", "list", apk]);
  const architectures = parseArchitectures(files);
  const packages = run(apkanalyzer, ["dex", "packages", "--defined-only", apk]);
  const signatureOutput = run(apksigner, ["verify", "--verbose", "--print-certs", apk], { includeStderr: true });
  // Some Android Build Tools/runner combinations keep the verbose verification
  // summary and certificate report on different streams. If the combined
  // invocation still omits the fingerprint, request the certificate report
  // independently instead of rejecting a correctly signed APK.
  const certificateOutput = parseCertificateDigest(signatureOutput)
    ? ""
    : run(apksigner, ["verify", "--print-certs", apk], { includeStderr: true });
  const certificate = resolveCertificateDigest(signatureOutput, certificateOutput);

  const failures = [];
  if (actualPackage !== expectedPackage) failures.push(`applicationId is ${actualPackage}, expected ${expectedPackage}`);
  if (expectedVersion && actualVersion !== expectedVersion) failures.push(`version is ${actualVersion}, expected ${expectedVersion}`);
  if (Number.isSafeInteger(expectedVersionCode) && actualVersionCode !== expectedVersionCode) failures.push(`versionCode is ${actualVersionCode}, expected ${expectedVersionCode}`);
  if (Number.isSafeInteger(manifest?.minSdk) && actualMinSdk !== manifest.minSdk) failures.push(`minSdk is ${actualMinSdk}, expected ${manifest.minSdk}`);
  if (Number.isSafeInteger(manifest?.targetSdk) && actualTargetSdk !== manifest.targetSdk) failures.push(`targetSdk is ${actualTargetSdk}, expected ${manifest.targetSdk}`);
  if (!equalSets(architectures, expectedArchitectures)) failures.push(`architectures are [${architectures}], expected [${expectedArchitectures}]`);
  if (/android:(?:debuggable|testOnly)="true"/.test(manifestXml)) failures.push("manifest is debuggable or test-only");
  for (const forbidden of FORBIDDEN_RELEASE_CLASSES) {
    if (packages.includes(forbidden)) failures.push(`forbidden development package is linked: ${forbidden}`);
  }
  for (const legalAsset of REQUIRED_LEGAL_ASSETS) {
    if (!files.split(/\r?\n/).includes(legalAsset)) failures.push(`required legal asset is missing: ${legalAsset}`);
  }
  if (!failures.some((failure) => failure.startsWith("required legal asset is missing:"))) {
    try {
      const inventory = JSON.parse(run(apkanalyzer, ["files", "cat", "--file", "/assets/legal/android/android-dependencies.json", apk]));
      const cdx = JSON.parse(run(apkanalyzer, ["files", "cat", "--file", "/assets/legal/android/snezhok-android.cdx.json", apk]));
      const notices = run(apkanalyzer, ["files", "cat", "--file", "/assets/legal/android/ANDROID_THIRD_PARTY_NOTICES.txt", apk]);
      const packagedTextPaths = files.split(/\r?\n/)
        .filter((file) => file.startsWith("/assets/legal/android/"))
        .map((file) => file.slice("/assets/legal/android/".length))
        // `apkanalyzer files list` includes directory entries as well as
        // regular files. Passing the `texts` directory to `files cat` fails
        // even when every generated legal text is correctly packaged.
        .filter((file) => /^texts\/[0-9a-f]{64}\.txt$/i.test(file));
      const packagedFiles = new Map(packagedTextPaths.map((file) => [
        file,
        run(apkanalyzer, ["files", "cat", "--file", `/assets/legal/android/${file}`, apk]),
      ]));
      failures.push(...validateAndroidEvidence(inventory, cdx, notices, packagedFiles, manifest?.sourceRevision ?? args.revision));
    } catch (error) {
      failures.push(`packaged Android dependency evidence cannot be read: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (!certificate) failures.push("APK signing certificate could not be read");
  if (!/Verified using v(?:2|3|3\.1) scheme[^:]*:\s*true/i.test(signatureOutput)) failures.push("APK has no verified modern v2/v3 signing scheme");
  if (!/Number of signers:\s*1\b/i.test(signatureOutput)) failures.push("APK must have exactly one signer");
  if (expectedCertificate && certificate !== expectedCertificate) failures.push(`signing certificate is ${certificate}, expected ${expectedCertificate}`);
  if (manifest) {
    const digest = await sha256(apk);
    if (apkInfo.size !== manifest.bytes) failures.push(`APK byte count is ${apkInfo.size}, expected ${manifest.bytes}`);
    if (digest !== manifest.sha256) failures.push(`APK SHA-256 is ${digest}, expected ${manifest.sha256}`);
  }

  if (failures.length) throw new Error(`release artifact verification failed:\n- ${failures.join("\n- ")}`);
  process.stdout.write(`verified release APK ${actualVersion} (${actualVersionCode}), ${architectures.join(", ")}, certificate ${certificate}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
