import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const platformRoot = path.resolve(scriptDirectory, "..", "..");
const mobileRoot = path.join(platformRoot, "apps", "mobile");
const androidRoot = path.join(mobileRoot, "android");
const targetPackage = "xyz.merchedits.snezhok";
const testNamespace = "xyz.merchedits.snezhok.e2e";

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const revision = (await command("git", ["rev-parse", "HEAD"], { cwd: platformRoot })).trim();
  if (options.prepareOnly) {
    await prepareAndroidModule();
    const testApk = await locateTestApk();
    process.stdout.write(`Messaging E2E instrumentation prepared: ${testApk}\n`);
    return;
  }

  const adb = await locateAdb();
  const devices = parseAdbDevices(await command(adb, ["devices", "-l"]));
  const serial = selectDevice(devices, options.serial ?? process.env.SNEZHOK_ANDROID_SERIAL?.trim());
  await prepareAndroidModule();
  const testApk = await locateTestApk();
  const property = async (name) => (await adbCommand(adb, serial, ["shell", "getprop", name])).trim();
  const [manufacturer, model, androidRelease, sdk] = await Promise.all([
    property("ro.product.manufacturer"), property("ro.product.model"), property("ro.build.version.release"), property("ro.build.version.sdk"),
  ]);
  const packagePath = (await adbCommand(adb, serial, ["shell", "pm", "path", targetPackage], { allowFailure: true })).trim();
  if (!packagePath.startsWith("package:")) {
    throw new Error("Snezhok is not installed on the selected device. Install the current release APK and sign in once before running this suite.");
  }
  if (options.apk) {
    const apk = path.resolve(options.apk);
    if (!(await stat(apk).catch(() => null))?.isFile()) throw new Error(`APK does not exist: ${apk}`);
    await adbCommand(adb, serial, ["install", "-r", apk], { inherit: true });
  }

  const photoSource = path.resolve(options.photo ?? path.join(mobileRoot, "assets", "snezhok-flower-icon.png"));
  if (!(await stat(photoSource).catch(() => null))?.isFile()) throw new Error(`Photo fixture does not exist: ${photoSource}`);
  const photoFilename = "snezhok-e2e-photo.png";
  const videoFilename = "snezhok-e2e-video.mp4";
  const photoDeviceDirectory = "/sdcard/Pictures/SnezhokE2E";
  const videoDevicePath = `${photoDeviceDirectory}/${videoFilename}`;

  await adbCommand(adb, serial, ["install", "-r", "-t", testApk], { inherit: true });
  await adbCommand(adb, serial, ["shell", "mkdir", "-p", photoDeviceDirectory]);
  await removeMediaFixtures(adb, serial, photoFilename, "images");
  await adbCommand(adb, serial, ["shell", "rm", "-f", videoDevicePath]);
  await adbCommand(adb, serial, ["shell", "am", "start", "-W", "-n", `${testNamespace}/.FixtureActivity`]);
  await waitForMediaFixture(adb, serial, photoFilename, "images");
  await adbCommand(adb, serial, ["shell", "screenrecord", "--time-limit", "2", "--size", "320x480", "--bit-rate", "500000", videoDevicePath]);
  await adbCommand(adb, serial, ["shell", "am", "force-stop", testNamespace]);
  await adbCommand(adb, serial, ["shell", "am", "broadcast", "-a", "android.intent.action.MEDIA_SCANNER_SCAN_FILE", "-d", `file://${videoDevicePath}`], { allowFailure: true });
  for (const permission of ["android.permission.RECORD_AUDIO", "android.permission.CAMERA", "android.permission.READ_MEDIA_IMAGES", "android.permission.READ_MEDIA_VIDEO", "android.permission.READ_EXTERNAL_STORAGE"]) {
    await adbCommand(adb, serial, ["shell", "pm", "grant", targetPackage, permission], { allowFailure: true });
  }

  const instrumentation = await findInstrumentation(adb, serial);
  const textMarker = `snezhok-e2e-${Date.now()}`;
  const scenarios = [
    { name: "text-cache", method: "sendTextForCacheProbe", arguments: { textMarker }, textCacheMarker: textMarker },
    { name: "attachment-drawer", method: "attachmentDrawerOpens" },
    { name: "photo-upload-viewer", method: "sendPhotoAndOpenViewer", arguments: { photoFilename } },
    { name: "video-upload-viewer", method: "sendVideoAndOpenViewer", arguments: { videoFilename } },
    ...(options.includeVoice ? [{ name: "voice-record-playback", method: "recordSendAndStartVoicePlayback" }] : []),
  ];
  const results = [];
  let suiteFailure = null;
  for (const scenario of scenarios) {
    const startedAt = Date.now();
    try {
      const output = scenario.textCacheMarker
        ? await runTextCacheScenario(adb, serial, instrumentation, scenario, scenario.textCacheMarker)
        : await runScenario(adb, serial, instrumentation, scenario);
      results.push({ name: scenario.name, status: "passed", durationMs: Date.now() - startedAt, output: sanitizeEvidence(output) });
      process.stdout.write(`PASS ${scenario.name} (${Date.now() - startedAt} ms)\n`);
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error));
      results.push({ name: scenario.name, status: "failed", durationMs: Date.now() - startedAt, failure: sanitizeEvidence(failure.message) });
      suiteFailure = failure;
      process.stderr.write(`FAIL ${scenario.name}: ${sanitizeEvidence(failure.message)}\n`);
    }
  }

  const packageInfo = await adbCommand(adb, serial, ["shell", "dumpsys", "package", targetPackage], { allowFailure: true });
  const timestamp = new Date().toISOString().replaceAll(":", "-");
  const evidenceRoot = path.join(platformRoot, "runtime", "evidence", "android-e2e", revision, timestamp);
  await mkdir(evidenceRoot, { recursive: true });
  const report = {
    schemaVersion: 1,
    status: suiteFailure ? "failed" : "passed",
    createdAt: new Date().toISOString(),
    sourceRevision: revision,
    targetPackage,
    device: {
      serialSha256: createHash("sha256").update(serial).digest("hex"),
      manufacturer,
      model,
      androidRelease,
      sdk: Number(sdk),
    },
    installedApp: parsePackageVersion(packageInfo),
    fixtures: {
      photo: { filename: photoFilename, sha256: createHash("sha256").update(await readFile(photoSource)).digest("hex") },
      video: { filename: videoFilename, sha256: await remoteSha256(adb, serial, videoDevicePath) },
    },
    scenarios: results,
  };
  await writeFile(path.join(evidenceRoot, "report.json"), `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
  process.stdout.write(`Messaging E2E evidence: ${evidenceRoot}\n`);
  if (suiteFailure) throw suiteFailure;
}

async function prepareAndroidModule() {
  await command(process.platform === "win32" ? "npx.cmd" : "npx", ["expo", "prebuild", "--no-install", "--platform", "android"], { cwd: mobileRoot, inherit: true });
  const gradle = path.join(androidRoot, process.platform === "win32" ? "gradlew.bat" : "gradlew");
  await command(gradle, [":messagingE2e:assembleFunctional", "--no-daemon", "--console=plain"], { cwd: androidRoot, inherit: true });
}

async function locateTestApk() {
  const outputRoot = path.join(androidRoot, "messagingE2e", "build", "outputs", "apk");
  const info = await stat(outputRoot).catch(() => null);
  if (!info?.isDirectory()) throw new Error("Messaging E2E build produced no APK directory");
  const matches = (await walk(outputRoot)).filter((file) => file.endsWith(".apk") && file.toLowerCase().includes("functional"));
  if (matches.length !== 1) throw new Error(`Expected one functional E2E APK, found ${matches.length}`);
  return matches[0];
}

async function findInstrumentation(adb, serial) {
  const output = await adbCommand(adb, serial, ["shell", "pm", "list", "instrumentation"]);
  const line = output.split(/\r?\n/).find((candidate) => candidate.includes(`instrumentation:${testNamespace}/`));
  const component = line?.match(/^instrumentation:([^\s]+)/)?.[1];
  if (!component) throw new Error("Installed messaging E2E instrumentation could not be discovered");
  return component;
}

async function runScenario(adb, serial, instrumentation, scenario) {
  const args = ["shell", "am", "instrument", "-w", "-r", "-e", "class", `${testNamespace}.MessagingSmokeTests#${scenario.method}`];
  for (const [key, value] of Object.entries(scenario.arguments ?? {})) args.push("-e", key, String(value));
  args.push(instrumentation);
  const output = await adbCommand(adb, serial, args, { allowFailure: true });
  if (!instrumentationPassed(output)) throw new Error(`Android instrumentation failed:\n${sanitizeEvidence(output).slice(-8_000)}`);
  return output;
}

async function runTextCacheScenario(adb, serial, instrumentation, scenario, marker) {
  const sendOutput = await runScenario(adb, serial, instrumentation, scenario);
  const committedReopenOutput = await runScenario(adb, serial, instrumentation, {
    method: "openSavedMessagesForCacheProbe",
    arguments: { textMarker: marker },
  });
  const wifiWasEnabled = (await adbCommand(adb, serial, ["shell", "settings", "get", "global", "wifi_on"])).trim() === "1";
  const mobileDataWasEnabled = (await adbCommand(adb, serial, ["shell", "settings", "get", "global", "mobile_data"])).trim() === "1";
  try {
    await adbCommand(adb, serial, ["shell", "svc", "wifi", "disable"]);
    await adbCommand(adb, serial, ["shell", "svc", "data", "disable"]);
    const cacheOutput = await runScenario(adb, serial, instrumentation, {
      method: "openSavedMessagesForCacheProbe",
      arguments: { textMarker: marker },
    });
    return `${sendOutput}\n${committedReopenOutput}\n${cacheOutput}`;
  } finally {
    await adbCommand(adb, serial, ["shell", "svc", "wifi", wifiWasEnabled ? "enable" : "disable"], { allowFailure: true });
    await adbCommand(adb, serial, ["shell", "svc", "data", mobileDataWasEnabled ? "enable" : "disable"], { allowFailure: true });
  }
}

async function remoteSha256(adb, serial, remotePath) {
  const output = await adbCommand(adb, serial, ["shell", "sha256sum", remotePath]);
  const digest = output.match(/^([0-9a-f]{64})\b/i)?.[1]?.toLowerCase();
  if (!digest) throw new Error("Could not hash the generated Android video fixture");
  return digest;
}

async function waitForMediaFixture(adb, serial, filename, collection) {
  const deadline = Date.now() + 8_000;
  do {
    const output = await queryMediaStore(adb, serial, collection);
    const mediaId = mediaStoreIdForFilename(output, filename);
    if (mediaId) return mediaId;
    await new Promise((resolve) => setTimeout(resolve, 250));
  } while (Date.now() < deadline);
  throw new Error("The private-safe photo fixture was not indexed by Android MediaStore");
}

async function removeMediaFixtures(adb, serial, filename, collection) {
  const output = await queryMediaStore(adb, serial, collection);
  for (const mediaId of mediaStoreIdsForFilename(output, filename)) {
    await adbCommand(adb, serial, ["shell", "content", "delete", "--uri", `content://media/external/${collection}/media/${mediaId}`], { allowFailure: true });
  }
}

function queryMediaStore(adb, serial, collection) {
  return adbCommand(adb, serial, [
    "shell", "content", "query", "--uri", `content://media/external/${collection}/media`, "--projection", "_id:_display_name",
  ], { allowFailure: true });
}

export function mediaStoreIdForFilename(output, filename) {
  return mediaStoreIdsForFilename(output, filename).at(-1) ?? null;
}

export function mediaStoreIdsForFilename(output, filename) {
  const ids = [];
  for (const line of String(output).split(/\r?\n/)) {
    const id = line.match(/\b_id=(\d+)\b/)?.[1];
    const name = line.match(/\b_display_name=([^,]+)(?:,|$)/)?.[1];
    if (id && name === filename) ids.push(id);
  }
  return ids;
}

function instrumentationPassed(output) {
  return /\bOK \(1 test\)/.test(output) && !/FAILURES!!!|INSTRUMENTATION_FAILED|Process crashed|shortMsg=/.test(output);
}

export function parseAdbDevices(output) {
  return output.split(/\r?\n/).slice(1).map((line) => line.trim()).filter(Boolean).map((line) => {
    const [serial, state, ...details] = line.split(/\s+/);
    return { serial, state, details: details.join(" ") };
  });
}

export function selectDevice(devices, requested) {
  const usable = devices.filter((device) => device.state === "device");
  if (requested) {
    const match = usable.find((device) => device.serial === requested);
    if (!match) throw new Error(`Requested Android device is not connected and authorized`);
    return match.serial;
  }
  if (usable.length !== 1) throw new Error(`Connect exactly one authorized Android device or set SNEZHOK_ANDROID_SERIAL (found ${usable.length})`);
  return usable[0].serial;
}

export function sanitizeEvidence(value) {
  return String(value)
    .replace(/Bearer\s+[A-Za-z0-9._~+\/-]+/gi, "Bearer [redacted]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted-email]")
    .replace(/([?&](?:token|capability|signature|key|secret)=)[^&\s]+/gi, "$1[redacted]")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi, "[redacted-id]")
    .slice(-20_000);
}

export function parsePackageVersion(output) {
  return {
    versionName: output.match(/\bversionName=([^\s]+)/)?.[1] ?? null,
    versionCode: Number(output.match(/\bversionCode=(\d+)/)?.[1] ?? 0) || null,
  };
}

function parseArguments(args) {
  const result = { prepareOnly: false, includeVoice: false, serial: null, apk: null, photo: null };
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === "--prepare-only") result.prepareOnly = true;
    else if (value === "--include-voice") result.includeVoice = true;
    else if (["--serial", "--apk", "--photo"].includes(value)) {
      const next = args[index + 1];
      if (!next) throw new Error(`Missing value for ${value}`);
      result[value.slice(2)] = next;
      index += 1;
    } else throw new Error(`Unknown argument: ${value}`);
  }
  return result;
}

async function locateAdb() {
  const executable = process.platform === "win32" ? "adb.exe" : "adb";
  const candidates = [process.env.ANDROID_SDK_ROOT, process.env.ANDROID_HOME, process.platform === "win32" ? path.join(os.homedir(), "AppData", "Local", "Android", "Sdk") : null]
    .filter(Boolean).map((root) => path.join(root, "platform-tools", executable));
  for (const candidate of candidates) if ((await stat(candidate).catch(() => null))?.isFile()) return candidate;
  await command(executable, ["version"]);
  return executable;
}

async function walk(root) {
  const files = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...await walk(target));
    else if (entry.isFile()) files.push(target);
  }
  return files.sort();
}

function adbCommand(adb, serial, args, options = {}) {
  return command(adb, ["-s", serial, ...args], options);
}

function command(executable, args, { cwd = platformRoot, env = process.env, inherit = false, allowFailure = false } = {}) {
  return new Promise((resolve, reject) => {
    const windowsScript = process.platform === "win32" && /\.(?:bat|cmd)$/i.test(executable);
    const child = spawn(executable, args, { cwd, env, shell: windowsScript, windowsHide: true, stdio: inherit ? "inherit" : ["ignore", "pipe", "pipe"] });
    const stdout = [];
    const stderr = [];
    child.stdout?.on("data", (chunk) => stdout.push(chunk));
    child.stderr?.on("data", (chunk) => stderr.push(chunk));
    child.once("error", reject);
    child.once("close", (code, signal) => {
      const output = `${Buffer.concat(stdout).toString("utf8")}${Buffer.concat(stderr).toString("utf8")}`;
      if (code !== 0 && !allowFailure) reject(new Error(`${path.basename(executable)} failed (${code ?? signal}): ${sanitizeEvidence(output).slice(-4_000)}`));
      else resolve(output);
    });
  });
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  await main().catch((error) => {
    process.stderr.write(`Messaging E2E failed: ${sanitizeEvidence(error instanceof Error ? error.message : String(error))}\n`);
    process.exitCode = 1;
  });
}
