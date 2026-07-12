import { spawn } from "node:child_process";
import { config } from "./config.js";

export interface CommandOptions {
  signal: AbortSignal;
  captureStdout?: boolean;
  maxStdoutBytes?: number;
  onHeartbeat?: () => Promise<void>;
}

export async function runMediaCommand(executable: string, args: readonly string[], options: CommandOptions) {
  if (options.signal.aborted) throw new DOMException("Media job cancelled", "AbortError");
  const command = process.platform === "linux" ? "nice" : executable;
  const commandArgs = process.platform === "linux" ? ["-n", String(config.PROCESS_NICENESS), executable, ...args] : [...args];
  return new Promise<Buffer>((resolve, reject) => {
    const child = spawn(command, commandArgs, { shell: false, windowsHide: true, stdio: ["ignore", options.captureStdout ? "pipe" : "ignore", "pipe"] });
    const stdout: Buffer[] = []; const stderr: Buffer[] = []; let stdoutBytes = 0;
    const terminate = () => { child.kill("SIGTERM"); setTimeout(() => child.kill("SIGKILL"), 5_000).unref(); };
    options.signal.addEventListener("abort", terminate, { once: true });
    child.stdout?.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > (options.maxStdoutBytes ?? 64 * 1024 * 1024)) terminate();
      else stdout.push(chunk);
    });
    child.stderr?.on("data", (chunk: Buffer) => { stderr.push(chunk); if (stderr.reduce((sum, item) => sum + item.length, 0) > 128 * 1024) stderr.shift(); });
    const heartbeat = setInterval(() => void options.onHeartbeat?.().catch(() => undefined), 10_000); heartbeat.unref();
    child.once("error", (error) => { clearInterval(heartbeat); options.signal.removeEventListener("abort", terminate); reject(error); });
    child.once("close", (code, signal) => {
      clearInterval(heartbeat); options.signal.removeEventListener("abort", terminate);
      if (options.signal.aborted) return reject(new DOMException("Media job cancelled", "AbortError"));
      if (stdoutBytes > (options.maxStdoutBytes ?? 64 * 1024 * 1024)) return reject(new Error("Media subprocess output exceeded its safety limit"));
      if (code !== 0) return reject(new Error(`${executable} exited with ${code ?? signal}: ${Buffer.concat(stderr).toString("utf8").slice(-4_000)}`));
      resolve(Buffer.concat(stdout));
    });
  });
}
