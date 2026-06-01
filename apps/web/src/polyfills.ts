const runtime = globalThis as typeof globalThis & {
  global?: typeof globalThis;
  process?: {
    env: Record<string, string | undefined>;
    nextTick?: (callback: (...args: any[]) => void, ...args: any[]) => void;
  };
};

runtime.global = runtime.global || globalThis;
runtime.process = runtime.process || { env: {} };
runtime.process.env = runtime.process.env || {};
runtime.process.nextTick =
  runtime.process.nextTick ||
  ((callback, ...args) => {
    queueMicrotask(() => callback(...args));
  });
