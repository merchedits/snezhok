import assert from "node:assert/strict";
import test from "node:test";
import { validateProductionEnvironment } from "./verify-production-environment.mjs";

const complete = {
  SNEZHOK_RELEASE_BUILD: "1",
  SNEZHOK_SOURCE_REVISION: "a".repeat(40),
  SNEZHOK_KEYSTORE_FILE: "/protected/release.jks",
  SNEZHOK_KEYSTORE_PASSWORD: "secret",
  SNEZHOK_KEY_ALIAS: "snezhok",
  SNEZHOK_KEY_PASSWORD: "secret",
  EXPO_PUBLIC_EAS_PROJECT_ID: "5811d22d-1e72-4b86-bf0a-8435aa34b15c",
  GOOGLE_SERVICES_JSON: "/protected/google-services.json",
};

const regularFile = { isFile: () => true, isSymbolicLink: () => false };
const firebaseDocument = JSON.stringify({
  project_info: { project_id: "snezhok-production", project_number: "123456789" },
  client: [{ client_info: { mobilesdk_app_id: "1:123456789:android:abcdef", android_client_info: { package_name: "xyz.merchedits.snezhok" } }, api_key: [{ current_key: "test-key" }] }],
});

test("accepts a complete protected production environment", async () => {
  assert.deepEqual(await validateProductionEnvironment(complete, {
    lstat: async () => regularFile,
    readFile: async () => firebaseDocument,
  }), []);
});

test("fails closed when push, signing or full source provenance is absent", async () => {
  const failures = await validateProductionEnvironment({
    SNEZHOK_RELEASE_BUILD: "1",
    SNEZHOK_SOURCE_REVISION: "abcdef0",
  }, { lstat: async () => { throw new Error("missing"); } });
  assert.match(failures.join("\n"), /complete 40-character/);
  assert.match(failures.join("\n"), /EXPO_PUBLIC_EAS_PROJECT_ID/);
  assert.match(failures.join("\n"), /GOOGLE_SERVICES_JSON/);
  assert.match(failures.join("\n"), /SNEZHOK_KEYSTORE_FILE/);
});

test("rejects Firebase configuration for another application", async () => {
  const failures = await validateProductionEnvironment(complete, {
    lstat: async () => regularFile,
    readFile: async () => JSON.stringify({ project_info: { project_id: "other" }, client: [] }),
  });
  assert.match(failures.join("\n"), /does not contain xyz\.merchedits\.snezhok/);
});

test("rejects an incomplete matching Firebase Android client", async () => {
  const failures = await validateProductionEnvironment(complete, {
    lstat: async () => regularFile,
    readFile: async () => JSON.stringify({ project_info: { project_id: "test", project_number: "123" }, client: [{ client_info: { android_client_info: { package_name: "xyz.merchedits.snezhok" } } }] }),
  });
  assert.match(failures.join("\n"), /mobile SDK app ID/);
  assert.match(failures.join("\n"), /API key/);
});
