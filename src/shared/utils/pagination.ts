/**
 * Shared pagination helpers for cursor-based and offset-based list endpoints.
 *
 * Convention (see docs/PAGINATION.md):
 * - Cursor (`cursor` / `nextCursor` / `hasMore`) for large collections
 * - Offset (`page` / `limit` / `total`) for bounded admin lists
 *
 * Pagination metadata always belongs in the response `meta` field — never in `data`.
 */

export interface CursorPage<T> {
  data: T[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface OffsetMeta {
  page: number;
  limit: number;
  total: number;
}

export interface CursorMeta {
  nextCursor: string | null;
  hasMore: boolean;
}

type IdLike = { toString(): string };

/**
 * Splits an over-fetched result set (limit + 1) into a page and cursor metadata.
 */
export function paginateCursor<T extends { _id: IdLike | string }>(
  items: T[],
  limit: number
): CursorPage<T> {
  const hasMore = items.length > limit;
  const data = hasMore ? items.slice(0, limit) : items;
  const last = data[data.length - 1];
  const nextCursor =
    hasMore && last != null
      ? typeof last._id === 'string'
        ? last._id
        : last._id.toString()
      : null;

  return { data, nextCursor, hasMore };
}

/** Computes MongoDB skip for 1-based page numbers. */
export function offsetSkip(page: number, limit: number): number {
  return Math.max(0, (page - 1) * limit);
}

export function cursorMeta(page: Pick<CursorPage<unknown>, 'nextCursor' | 'hasMore'>): CursorMeta {
  return { nextCursor: page.nextCursor, hasMore: page.hasMore };
}

export function offsetMeta(page: number, limit: number, total: number): OffsetMeta {
  return { page, limit, total };
}
