/**
 * A populated virtualized list must size its content from its rows so the first
 * conversation stays directly below the filters. Only an empty list needs a
 * viewport-filling content container for its empty-state presentation.
 */
export function shouldFillChatListViewport(rowCount: number): boolean {
  return rowCount === 0;
}
