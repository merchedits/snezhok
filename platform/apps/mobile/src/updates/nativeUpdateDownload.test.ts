import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const nativeSource = new URL("../../modules/snezhok-call-service/android/src/main/java/xyz/merchedits/snezhok/calls/SnezhokCallServiceModule.kt", import.meta.url);

test("Android updates retain partial bytes and validate resumed range responses", async () => {
  const source = await readFile(nativeSource, "utf8");
  assert.match(source, /File\("\$\{destination\.absolutePath\}\.part"\)/);
  assert.match(source, /setRequestProperty\("Range", "bytes=\$requestedOffset-"\)/);
  assert.match(source, /parseContentRange\(connection\.getHeaderField\("Content-Range"\)\)/);
  assert.match(source, /range\.first != requestedOffset \|\| range\.second != expectedBytes/);
  assert.doesNotMatch(source, /partial\.delete\(\)[\s\S]{0,120}catch \(error: IOException\)/);
});

test("Android updates are bounded, hashed natively, and finalized atomically", async () => {
  const source = await readFile(nativeSource, "utf8");
  assert.match(source, /expectedBytes in MIN_UPDATE_BYTES\.\.MAX_UPDATE_BYTES/);
  assert.match(source, /if \(total \+ count > expectedBytes\)/);
  assert.match(source, /val digest = sha256\(partial\)/);
  assert.match(source, /if \(digest != expectedSha256\)/);
  assert.match(source, /partial\.renameTo\(destination\)/);
  assert.match(source, /urls\[\(attempt - 1\) % urls\.size\]/);
});

test("Android update installation uses a verified FileProvider URI and explicit source permission", async () => {
  const source = await readFile(nativeSource, "utf8");
  assert.match(source, /packageManager\.canRequestPackageInstalls\(\)/);
  assert.match(source, /Settings\.ACTION_MANAGE_UNKNOWN_APP_SOURCES/);
  assert.match(source, /FileProvider\.getUriForFile/);
  assert.match(source, /Intent\.FLAG_GRANT_READ_URI_PERMISSION/);
  assert.match(source, /ClipData\.newRawUri/);
  assert.match(source, /Intent\.ACTION_INSTALL_PACKAGE/);
  assert.match(source, /Intent\.ACTION_VIEW/);
  assert.match(source, /sha256\(apk\) != expectedSha256/);
});

test("JavaScript delegates installation to the native module without awaiting Expo IntentLauncher", async () => {
  const providerSource = await readFile(new URL("./UpdateProvider.tsx", import.meta.url), "utf8");
  assert.match(providerSource, /requestAndroidUpdateInstallation/);
  assert.doesNotMatch(providerSource, /expo-intent-launcher|IntentLauncher/);
});
