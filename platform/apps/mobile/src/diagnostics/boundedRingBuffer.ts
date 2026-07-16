/** Append in place so high-frequency diagnostics do not allocate a new array. */
export function appendBounded<T>(items: T[], item: T, limit: number): void {
  if (limit <= 0) {
    items.length = 0;
    return;
  }
  items.push(item);
  if (items.length > limit) items.splice(0, items.length - limit);
}
