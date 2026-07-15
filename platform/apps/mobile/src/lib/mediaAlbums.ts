export const MAX_MEDIA_PER_MESSAGE = 10;

export function chunkMediaMessages<T>(items: readonly T[]): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += MAX_MEDIA_PER_MESSAGE) {
    chunks.push(items.slice(index, index + MAX_MEDIA_PER_MESSAGE));
  }
  return chunks;
}

/** Compact Telegram-like rows that keep albums at three rows whenever possible. */
export function mediaAlbumRows<T>(items: readonly T[]): T[][] {
  const count = items.length;
  if (count <= 1) return count ? [[items[0]!]] : [];
  const rowSizes = count === 2 ? [2]
    : count === 3 ? [3]
      : count === 4 ? [2, 2]
        : count === 5 ? [2, 3]
          : count === 6 ? [3, 3]
            : count === 7 ? [2, 2, 3]
              : count === 8 ? [2, 3, 3]
                : count === 9 ? [3, 3, 3]
                  : [3, 3, 4];
  const rows: T[][] = [];
  let offset = 0;
  for (const size of rowSizes) {
    rows.push(items.slice(offset, offset + size));
    offset += size;
  }
  return rows;
}
