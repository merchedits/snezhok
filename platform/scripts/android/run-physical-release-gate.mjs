import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { cp, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { validateBenchmarkReports } from "./benchmark-evidence.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const platformRoot = path.resolve(scriptDirectory, "..", "..");

async function main() {
  const repositoryRoot = (await command("git", ["rev-parse", "--show-toplevel"], { cwd: platformRoot })).trim();
  const revision = (await command("git", ["rev-parse", "HEAD"], { cwd: repositoryRoot })).trim();
  const platformStatus = await command("git", ["status", "--short", "--", "platform"], { cwd: repositoryRoot });
  if (platformStatus.trim()) throw new Error("Physical release evidence requires a clean platform subtree");

  const adb = await locateAdb();
  const serial = selectDevice(parseAdbDevices(await command(adb, ["devices", "-l"])));
  const property = async (name) => (await command(adb, ["-s", serial, "shell", "getprop", name])).trim();
  const [model, manufacturer, sdk, release, emulator] = await Promise.all([
    property("ro.product.model"), property("ro.product.manufacturer"), property("ro.build.version.sdk"),
    property("ro.build.version.release"), property("ro.kernel.qemu"),
  ]);
  if (emulator === "1" || /sdk|emulator/i.test(model)) throw new Error("Physical release evidence cannot be generated on an emulator");
  const requiredModel = argument("--require-model");
  if (requiredModel && model.toLowerCase() !== requiredModel.toLowerCase()) throw new Error(`Connected device is ${model}; required ${requiredModel}`);
  if (Number(sdk) < 28) throw new Error(`Macrobenchmark requires Android API 28 or newer; connected device reports ${sdk}`);

  const androidRoot = path.join(platformRoot, "apps", "mobile", "android");
  const gradle = path.join(androidRoot, process.platform === "win32" ? "gradlew.bat" : "gradlew");
  await command(gradle, [":macrobenchmark:connectedBenchmarkAndroidTest", "--no-daemon", "--console=plain"], {
    cwd: androidRoot,
    env: { ...process.env, ANDROID_SERIAL: serial },
    inherit: true,
  });

  const source = path.join(androidRoot, "macrobenchmark", "build", "outputs", "connected_android_test_additional_output");
  const sourceInfo = await stat(source).catch(() => null);
  if (!sourceInfo?.isDirectory()) throw new Error("Macrobenchmark finished without retrievable additional output");
  const reportFiles = (await walk(source)).filter((file) => file.endsWith("-benchmarkData.json"));
  if (!reportFiles.length) throw new Error("Macrobenchmark produced no benchmarkData JSON report");
  const reports = await Promise.all(reportFiles.map(async (file) => JSON.parse(await readFile(file, "utf8"))));
  const validation = validateBenchmarkReports(reports);
  if (validation.failures.length) throw new Error(`Physical performance gate failed:\n- ${validation.failures.join("\n- ")}`);

  const timestamp = new Date().toISOString().replaceAll(":", "-");
  const evidenceRoot = path.join(platformRoot, "runtime", "evidence", "android", revision, timestamp);
  await mkdir(evidenceRoot, { recursive: true });
  await cp(source, path.join(evidenceRoot, "macrobenchmark"), { recursive: true, force: false, errorOnExist: true });
  const copiedFiles = await walk(path.join(evidenceRoot, "macrobenchmark"));
  const manifest = {
    schemaVersion: 1,
    status: "passed",
    createdAt: new Date().toISOString(),
    sourceRevision: revision,
    device: {
      serialSha256: createHash("sha256").update(serial).digest("hex"),
      manufacturer,
      model,
      androidRelease: release,
      sdk: Number(sdk),
    },
    benchmarkCount: validation.benchmarks,
    files: await Promise.all(copiedFiles.map(async (file) => ({
      path: path.relative(evidenceRoot, file).replaceAll("\\", "/"),
      bytes: (await stat(file)).size,
      sha256: createHash("sha256").update(await readFile(file)).digest("hex"),
    }))),
  };
  await writeFile(path.join(evidenceRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
  process.stdout.write(`Physical Android release gate passed on ${manufacturer} ${model}. Evidence: ${evidenceRoot}\n`);
}

export function parseAdbDevices(output) {
  return output.split(/\r?\n/).slice(1).map((line) => line.trim()).filter(Boolean).map((line) => {
    const [serial, state, ...details] = line.split(/\s+/);
    return { serial, state, details: details.join(" ") };
  });
}

export function selectDevice(devices, requested = process.env.SNEZHOK_ANDROID_SERIAL?.trim()) {
  const usable = devices.filter((device) => device.state === "device");
  if (requested) {
    const match = usable.find((device) => device.serial === requested);
    if (!match) throw new Error(`Requested Android device ${requested} is not connected and authorized`);
    return match.serial;
  }
  if (usable.length !== 1) throw new Error(`Connect exactly one authorized physical Android device or set SNEZHOK_ANDROID_SERIAL (found ${usable.length})`);
  return usable[0].serial;
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index < 0 ? null : process.argv[index + 1] ?? null;
}

async function locateAdb() {
  const executable = process.platform === "win32" ? "adb.exe" : "adb";
  const candidates = [
    process.env.ANDROID_SDK_ROOT,
    process.env.ANDROID_HOME,
    process.platform === "win32" ? path.join(os.homedir(), "AppData", "Local", "Android", "Sdk") : null,
  ].filter(Boolean).map((root) => path.join(root, "platform-tools", executable));
  for (const candidate of candidates) {
    if ((await stat(candidate).catch(() => null))?.isFile()) return candidate;
  }
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

function command(executable, args, { cwd = platformRoot, env = process.env, inherit = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd, env, shell: process.platform === "win32" && executable.toLowerCase().endsWith(".bat"), windowsHide: true,
      stdio: inherit ? "inherit" : ["ignore", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    child.stdout?.on("data", (chunk) => stdout.push(chunk));
    child.stderr?.on("data", (chunk) => stderr.push(chunk));
    child.once("error", reject);
    child.once("close", (code, signal) => {
      if (code !== 0) reject(new Error(`${path.basename(executable)} failed (${code ?? signal}): ${Buffer.concat(stderr).toString("utf8").slice(-4_000)}`));
      else resolve(inherit ? "" : Buffer.concat(stdout).toString("utf8"));
    });
  });
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  await main();
}
