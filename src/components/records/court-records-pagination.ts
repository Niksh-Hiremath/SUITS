export const COURT_RECORDS_MAX_PAGE_SIZE = 100;

export type CourtRecordsPage<T> = Readonly<{
  items: ReadonlyArray<T>;
  /** One-based position of the first item, or zero when the result is empty. */
  start: number;
  /** One-based inclusive position of the last item, or zero when empty. */
  end: number;
  total: number;
  page: number;
  pageCount: number;
}>;

export function validateCourtRecordsPageSize(pageSize: number): number {
  if (
    !Number.isSafeInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > COURT_RECORDS_MAX_PAGE_SIZE
  ) {
    throw new RangeError(
      `Court Records page size must be a safe integer between 1 and ${COURT_RECORDS_MAX_PAGE_SIZE}.`,
    );
  }

  return pageSize;
}

function normalizeRequestedPage(requestedPage: number, pageCount: number): number {
  if (!Number.isSafeInteger(requestedPage) || requestedPage < 1) {
    return 1;
  }

  return Math.min(requestedPage, pageCount);
}

/**
 * Returns a fresh, bounded page without changing the source collection.
 * `start` and `end` are one-based display positions; both are zero when empty.
 */
export function paginateCourtRecords<T>(
  source: ReadonlyArray<T>,
  requestedPage: number,
  pageSize: number,
): CourtRecordsPage<T> {
  const boundedPageSize = validateCourtRecordsPageSize(pageSize);
  const total = source.length;
  const pageCount = Math.max(1, Math.ceil(total / boundedPageSize));
  const page = normalizeRequestedPage(requestedPage, pageCount);
  const offset = (page - 1) * boundedPageSize;
  const items = Object.freeze(source.slice(offset, offset + boundedPageSize));
  const start = items.length === 0 ? 0 : offset + 1;
  const end = items.length === 0 ? 0 : offset + items.length;

  return Object.freeze({ items, start, end, total, page, pageCount });
}
