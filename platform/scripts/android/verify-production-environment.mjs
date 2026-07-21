#!/usr/bin/env node
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REQUIRED_SECRET_VALUES = [
  "SNEZHOK_KEYSTORE_PASSWORD",
  "SNEZHOK_KEY_ALIAS",
  "SNEZHOK_KEY_PASSWORD",
];

export async function validateProductionEnvironment(environment, dependencies = {}) {
  const inspect = dependencies.lstat ?? lstat;
  const read = dependencies.readFile ?? readFile;
  const failures = [];
  const sourceRevision = environment.SNEZHOK_SOURCE_REVISION ?? "";
  const easProjectId = environment.EXPO_PUBLIC_EAS_PROJECT_ID ?? "";
  const keystoreFile = environment.SNEZHOK_KEYSTORE_FILE ?? "";
  const googleServicesFile = environment.GOOGLE_SERVICES_JSON ?? "";

  if (environment.SNEZHOK_RELEASE_BUILD !== "1") failures.push("SNEZHOK_RELEASE_BUILD must be 1");
  if (!/^[0-9a-f]{40}$/i.test(sourceRevision)) failures.push("SNEZHOK_SOURCE_REVISION must be a complete 40-character Git commit ID");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(easProjectId)) failures.push("EXPO_PUBLIC_EAS_PROJECT_ID must be configured");
  for (const name of REQUIRED_SECRET_VALUES) {
    if (!String(environment[name] ?? "").trim()) failures.push(`${name} must be configured`);
  }

  await validateProtectedFile("SNEZHOK_KEYSTORE_FILE", keystoreFile, inspect, failures);
  await validateProtectedFile("GOOGLE_SERVICES_JSON", googleServicesFile, inspect, failures);
  if (googleServicesFile && !failures.some((failure) => failure.startsWith("GOOGLE_SERVICES_JSON"))) {
    try {
      const document = JSON.parse(await read(path.resolve(googleServicesFile), "utf8"));
      const clients = Array.isArray(document?.client) ? document.client : [];
      const androidClient = clients.find((client) => client?.client_info?.android_client_info?.package_name === "xyz.merchedits.snezhok");
      if (typeof document?.project_info?.project_id !== "string" || !document.project_info.project_id.trim()) failures.push("GOOGLE_SERVICES_JSON has no Firebase project ID");
      if (!androidClient) failures.push("GOOGLE_SERVICES_JSON does not contain xyz.merchedits.snezhok");
    } catch {
      failures.push("GOOGLE_SERVICES_JSON is not valid JSON");
    }
  }
  return failures;
}

async function validateProtectedFile(name, filename, inspect, failures) {
  if (!filename) {
    failures.push(`${name} must be configured`);
    return;
  }
  try {
    const metadata = await inspect(path.resolve(filename));
    if (!metadata.isFile()) failures.push(`${name} must reference a regular file`);
    if (metadata.isSymbolicLink()) failures.push(`${name} must not reference a symbolic link`);
  } catch {
    failures.push(`${name} file is unavailable`);
  }
}

async function main() {
  const failures = await validateProductionEnvironment(process.env);
  if (failures.length) throw new Error(`production Android environment verification failed:\n- ${failures.join("\n- ")}`);
  process.stdout.write("production Android signing, push and source environment is complete\n");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
