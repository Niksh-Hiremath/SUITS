import { describe, expect, it } from "vitest";

import {
  COURT_RECORDS_MAX_PAGE_SIZE,
  paginateCourtRecords,
  validateCourtRecordsPageSize,
} from "./court-records-pagination";

describe("validateCourtRecordsPageSize", () => {
  it("accepts positive safe integers through the hard maximum", () => {
    expect(validateCourtRecordsPageSize(1)).toBe(1);
    expect(validateCourtRecordsPageSize(COURT_RECORDS_MAX_PAGE_SIZE)).toBe(
      COURT_RECORDS_MAX_PAGE_SIZE,
    );
  });

  it.each([
    0,
    -1,
    1.5,
    COURT_RECORDS_MAX_PAGE_SIZE + 1,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.MAX_SAFE_INTEGER + 1,
  ])("rejects the invalid page size %s", (pageSize) => {
    expect(() => validateCourtRecordsPageSize(pageSize)).toThrow(RangeError);
  });
});

describe("paginateCourtRecords", () => {
  it("returns a stable empty-state page for an empty source", () => {
    expect(paginateCourtRecords([], 99, 10)).toEqual({
      items: [],
      start: 0,
      end: 0,
      total: 0,
      page: 1,
      pageCount: 1,
    });
  });

  it("uses one page for an exact page-size match", () => {
    const source = Array.from({ length: 10 }, (_, index) => index + 1);

    expect(paginateCourtRecords(source, 1, 10)).toEqual({
      items: source,
      start: 1,
      end: 10,
      total: 10,
      page: 1,
      pageCount: 1,
    });
  });

  it("returns only the overflow items on the final page", () => {
    const source = Array.from({ length: 11 }, (_, index) => index + 1);

    expect(paginateCourtRecords(source, 2, 10)).toEqual({
      items: [11],
      start: 11,
      end: 11,
      total: 11,
      page: 2,
      pageCount: 2,
    });
  });

  it.each([0, -8, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "resets the invalid requested page %s to the first page",
    (requestedPage) => {
      const result = paginateCourtRecords(["first", "second", "third"], requestedPage, 2);

      expect(result.page).toBe(1);
      expect(result.items).toEqual(["first", "second"]);
    },
  );

  it("clamps a stale page to the new final page", () => {
    const result = paginateCourtRecords(
      Array.from({ length: 11 }, (_, index) => index + 1),
      3,
      10,
    );

    expect(result).toEqual({
      items: [11],
      start: 11,
      end: 11,
      total: 11,
      page: 2,
      pageCount: 2,
    });
  });

  it("handles a 20,000-item source at the hard page-size limit", () => {
    const source = Array.from({ length: 20_000 }, (_, index) => index);
    const result = paginateCourtRecords(
      source,
      200,
      COURT_RECORDS_MAX_PAGE_SIZE,
    );

    expect(result.pageCount).toBe(200);
    expect(result.page).toBe(200);
    expect(result.start).toBe(19_901);
    expect(result.end).toBe(20_000);
    expect(result.total).toBe(20_000);
    expect(result.items).toEqual(source.slice(19_900));
  });

  it("preserves source order and object identity in a replacement array", () => {
    const first = { trialId: "trial:first" };
    const second = { trialId: "trial:second" };
    const third = { trialId: "trial:third" };
    const source = Object.freeze([first, second, third]);
    const snapshot = [...source];

    const result = paginateCourtRecords(source, 1, 2);

    expect(result.items).not.toBe(source);
    expect(result.items[0]).toBe(first);
    expect(result.items[1]).toBe(second);
    expect(source).toEqual(snapshot);
    expect(source[2]).toBe(third);
  });
});
