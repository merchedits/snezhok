import { spawn } from "node:child_process";
import { config } from "./config.js";

export interface CommandOptions {
  signal: AbortSignal;
  captureStdout?: boolean;
  maxStdoutBytes?: number;
  onHeartbeat?: () => Promise<void>;
  /** Exposed for deterministic tests; production uses a ten-second lease pulse. */
  heartbeatIntervalMs?: number;
}

export async function runMediaCommand(executable: string, args: readonly string[], options: CommandOptions) {
  if (options.signal.aborted) throw new DOMException("Media job cancelled", "AbortError");
  const command = process.platform === "linux" ? "nice" : executable;
  const commandArgs = process.platform === "linux" ? ["-n", String(config.PROCESS_NICENESS), executable, ...args] : [...args];
  return new Promise<Buffer>((resolve, reject) => {
    const child = spawn(command, commandArgs, { shell: false, windowsHide: true, stdio: ["ignore", options.captureStdout ? "pipe" : "ignore", "pipe"] });
    const stdout: Buffer[] = []; const stderr: Buffer[] = []; let stdoutBytes = 0; let stderrBytes = 0; let timedOut = false;
    let heartbeatInFlight = false;
    let heartbeatError: unknown;
    let killTimer: NodeJS.Timeout | undefined;
    const terminate = () => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      child.kill("SIGTERM");
      killTimer ??= setTimeout(() => child.kill("SIGKILL"), 5_000);
      killTimer.unref();
    };
    const timeout = setTimeout(() => { timedOut = true; terminate(); }, config.MEDIA_COMMAND_TIMEOUT_MS); timeout.unref();
    options.signal.addEventListener("abort", terminate, { once: true });
    child.stdout?.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > (options.maxStdoutBytes ?? 64 * 1024 * 1024)) terminate();
      else stdout.push(chunk);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr.push(chunk); stderrBytes += chunk.length;
      while (stderrBytes > 128 * 1024 && stderr.length > 1) stderrBytes -= stderr.shift()!.length;
    });
    const heartbeat = setInterval(() => {
      if (!options.onHeartbeat || heartbeatInFlight) return;
      heartbeatInFlight = true;
      void options.onHeartbeat().catch((error: unknown) => {
        heartbeatError = error;
        terminate();
      }).finally(() => { heartbeatInFlight = false; });
    }, options.heartbeatIntervalMs ?? 10_000); heartbeat.unref();
    const cleanup = () => {
      clearTimeout(timeout);
      clearInterval(heartbeat);
      if (killTimer) clearTimeout(killTimer);
      options.signal.removeEventListener("abort", terminate);
    };
    child.once("error", (error) => { cleanup(); reject(error); });
    child.once("close", (code, signal) => {
      cleanup();
      if (options.signal.aborted) return reject(new DOMException("Media job cancelled", "AbortError"));
      if (heartbeatError) return reject(heartbeatError);
      if (stdoutBytes > (options.maxStdoutBytes ?? 64 * 1024 * 1024)) return reject(new Error("Media subprocess output exceeded its safety limit"));
      if (timedOut) return reject(new Error(`${executable} exceeded the ${config.MEDIA_COMMAND_TIMEOUT_MS} ms processing timeout`));
      if (code !== 0) return reject(new Error(`${executable} exited with ${code ?? signal}: ${Buffer.concat(stderr).toString("utf8").slice(-4_000)}`));
      resolve(Buffer.concat(stdout));
    });
  });
}
