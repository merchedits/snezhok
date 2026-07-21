import assert from "node:assert/strict";
import test from "node:test";

import { runMediaCommand } from "./subprocess.js";

test("a lost database lease terminates the media subprocess promptly", async () => {
  const leaseError = new DOMException("Media job lease lost", "AbortError");
  const startedAt = performance.now();

  await assert.rejects(
    runMediaCommand(
      process.execPath,
      ["-e", "setInterval(() => {}, 1000)"],
      {
        signal: new AbortController().signal,
        heartbeatIntervalMs: 20,
        onHeartbeat: async () => { throw leaseError; },
      },
    ),
    (error: unknown) => error === leaseError,
  );

  assert.ok(performance.now() - startedAt < 2_000, "lease loss should not leave ffmpeg running");
});

test("heartbeats never overlap for a slow database response", async () => {
  const controller = new AbortController();
  let concurrent = 0;
  let maximumConcurrent = 0;
  let calls = 0;
  const command = runMediaCommand(
    process.execPath,
    ["-e", "setTimeout(() => {}, 140)"],
    {
      signal: controller.signal,
      heartbeatIntervalMs: 10,
      onHeartbeat: async () => {
        calls += 1;
        concurrent += 1;
        maximumConcurrent = Math.max(maximumConcurrent, concurrent);
        await new Promise((resolve) => setTimeout(resolve, 35));
        concurrent -= 1;
      },
    },
  );

  await command;
  assert.ok(calls >= 2);
  assert.equal(maximumConcurrent, 1);
});

test("stdout can be consumed incrementally without the capture buffer limit", async () => {
  let bytes = 0;
  const result = await runMediaCommand(process.execPath, ["-e", "process.stdout.write(Buffer.alloc(256 * 1024))"], {
    signal: new AbortController().signal,
    maxStdoutBytes: 1,
    onStdoutChunk: (chunk) => { bytes += chunk.length; },
  });
  assert.equal(result.length, 0);
  assert.equal(bytes, 256 * 1024);
});
