export const PERFORMANCE_BUDGETS_MS = {
  tabResponse: 17,
  warmChatOpen: 150,
  cachedChatOpen: 350,
  interactionResponse: 100,
  attachmentDrawerOpen: 400,
  mediaViewerOpen: 450,
  uploadChunk: 2_500,
} as const;

export type PerformanceBudget = keyof typeof PERFORMANCE_BUDGETS_MS;

export function evaluatePerformanceBudget(name: PerformanceBudget, durationMs: number): { budgetMs: number; passed: boolean } {
  const budgetMs = PERFORMANCE_BUDGETS_MS[name];
  return { budgetMs, passed: Number.isFinite(durationMs) && durationMs <= budgetMs };
}
