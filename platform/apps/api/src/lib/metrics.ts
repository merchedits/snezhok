const startedAt = Date.now();

interface RouteMetric {
  requests: number;
  errors: number;
  totalDurationMs: number;
  maxDurationMs: number;
}

const routes = new Map<string, RouteMetric>();
const counters = new Map<string, number>();

export function observeHttpRequest(method: string, route: string, statusCode: number, durationMs: number): void {
  const key = `${method.toUpperCase()} ${normalizeRoute(route)}`;
  const current = routes.get(key) ?? { requests: 0, errors: 0, totalDurationMs: 0, maxDurationMs: 0 };
  current.requests += 1;
  if (statusCode >= 500) current.errors += 1;
  current.totalDurationMs += durationMs;
  current.maxDurationMs = Math.max(current.maxDurationMs, durationMs);
  routes.set(key, current);
}

export function incrementMetric(name: string, amount = 1): void {
  counters.set(name, (counters.get(name) ?? 0) + amount);
}

export function metricsSnapshot() {
  return {
    startedAt,
    uptimeSeconds: Math.floor((Date.now() - startedAt) / 1_000),
    counters: Object.fromEntries([...counters.entries()].sort(([left], [right]) => left.localeCompare(right))),
    routes: [...routes.entries()]
      .map(([route, metric]) => ({
        route,
        requests: metric.requests,
        errors: metric.errors,
        averageDurationMs: metric.requests ? Math.round((metric.totalDurationMs / metric.requests) * 10) / 10 : 0,
        maxDurationMs: Math.round(metric.maxDurationMs * 10) / 10,
      }))
      .sort((left, right) => right.requests - left.requests)
      .slice(0, 100),
  };
}

function normalizeRoute(route: string): string {
  return route
    .split("?", 1)[0]!
    .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, ":id")
    .replace(/\/\d+(?=\/|$)/g, "/:number");
}
