/** Preserves the original array identity unless at least one item changes. */
export function mapIfChanged<T>(items: T[], transform: (item: T, index: number) => T): T[] {
  let next: T[] | null = null;
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index]!;
    const transformed = transform(item, index);
    if (!next && transformed !== item) next = items.slice(0, index);
    next?.push(transformed);
  }
  return next ?? items;
}
