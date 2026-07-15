import assert from "node:assert/strict";
import test from "node:test";
import { evaluatePerformanceBudget, PERFORMANCE_BUDGETS_MS } from "./performanceBudgets";

test("low-end Android interaction budgets stay explicit and enforceable", () => {
  assert.deepEqual(evaluatePerformanceBudget("warmChatOpen", 149), { budgetMs: 150, passed: true });
  assert.deepEqual(evaluatePerformanceBudget("warmChatOpen", 151), { budgetMs: 150, passed: false });
  assert.equal(PERFORMANCE_BUDGETS_MS.tabResponse, 17);
  assert.equal(PERFORMANCE_BUDGETS_MS.cachedChatOpen, 350);
  assert.equal(PERFORMANCE_BUDGETS_MS.attachmentDrawerOpen, 400);
  assert.equal(PERFORMANCE_BUDGETS_MS.mediaViewerOpen, 450);
  assert.equal(PERFORMANCE_BUDGETS_MS.uploadChunk, 2_500);
});
