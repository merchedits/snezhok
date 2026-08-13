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
