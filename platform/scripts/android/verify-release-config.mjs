#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const mobileRoot = path.resolve(scriptDirectory, "../../apps/mobile");
const mobilePackage = JSON.parse(await readFile(path.join(mobileRoot, "package.json"), "utf8"));
const eas = JSON.parse(await readFile(path.join(mobileRoot, "eas.json"), "utf8"));
const contractsPackage = JSON.parse(await readFile(path.resolve(mobileRoot, "../../packages/contracts/package.json"), "utf8"));
const appConfig = await readFile(path.join(mobileRoot, "app.config.ts"), "utf8");
const entrypoint = await readFile(path.join(mobileRoot, "index.ts"), "utf8");
const failures = [];

if (mobilePackage.dependencies?.["expo-dev-client"]) failures.push("expo-dev-client must not be a production dependency");
if (!mobilePackage.devDependencies?.["expo-dev-client"]) failures.push("expo-dev-client must remain available as a development-only dependency");
for (const profileName of ["preview", "production"]) {
  const profile = eas.build?.[profileName];
  if (!profile) {
    failures.push(`missing EAS ${profileName} profile`);
    continue;
  }
  if (profile.developmentClient === true) failures.push(`${profileName} must not enable developmentClient`);
  if (profile.environment !== profileName) failures.push(`${profileName} must use the matching EAS environment`);
  if (!String(profile.env?.NPM_CONFIG_OMIT ?? "").split(/[,\s]+/).includes("dev")) failures.push(`${profileName} must omit devDependencies during install`);
  if (profile.env?.SNEZHOK_RELEASE_BUILD !== "1") failures.push(`${profileName} must declare SNEZHOK_RELEASE_BUILD=1`);
}
if (eas.build?.development?.developmentClient !== true) failures.push("development profile must retain the Expo development client");
if (eas.build?.development?.environment !== "development") failures.push("development must use the development EAS environment");
if (eas.build?.preview?.distribution !== "internal" || eas.build?.preview?.android?.buildType !== "apk") failures.push("preview must produce an internally distributed APK");
if (eas.build?.production?.distribution !== "store" || eas.build?.production?.android?.buildType !== "app-bundle") failures.push("production must produce a store-distributed Android App Bundle");
if (contractsPackage.exports?.["."]?.["react-native"] !== "./src/index.ts") failures.push("contracts must expose source to clean React Native builds without build-only devDependencies");
if (!mobilePackage.dependencies?.["expo-notifications"] || !mobilePackage.dependencies?.["expo-task-manager"]) failures.push("production notification dependencies are incomplete");
if (!appConfig.includes('"expo-notifications"')) failures.push("expo-notifications config plugin is missing");
if (!entrypoint.includes('import "./src/notifications/backgroundNotificationTask"')) failures.push("background notification task must load before the app root");

if (failures.length) {
  process.stderr.write(`release configuration verification failed:\n- ${failures.join("\n- ")}\n`);
  process.exit(1);
}
process.stdout.write("release profiles isolate the Expo development client from production artifacts\n");
