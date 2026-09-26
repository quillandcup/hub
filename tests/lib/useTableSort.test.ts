import { describe, it, expect } from "vitest";
import {
  compareSortValues,
  nextSortConfig,
  nextTableSort,
  sortRows,
  type SortConfig,
  type SortValue,
} from "@/lib/hooks/useTableSort";

describe("nextSortConfig", () => {
  it("sorts ascending on first click", () => {
    expect(nextSortConfig(null, "name")).toEqual({ column: "name", direction: "asc" });
  });

  it("sorts descending on second click of the same column", () => {
    const asc: SortConfig<"name"> = { column: "name", direction: "asc" };
    expect(nextSortConfig(asc, "name")).toEqual({ column: "name", direction: "desc" });
  });

  it("clears the sort on a third click of the same column", () => {
    const desc: SortConfig<"name"> = { column: "name", direction: "desc" };
    expect(nextSortConfig(desc, "name")).toBeNull();
  });

  it("restarts a different column at ascending, regardless of prior direction", () => {
    const desc: SortConfig<"name"> = { column: "name", direction: "desc" };
    expect(nextSortConfig(desc, "email")).toEqual({ column: "email", direction: "asc" });
  });
});

describe("sortRows", () => {
  const rows = [
    { id: "b", name: "Bob", score: 2 },
    { id: "a", name: "Alice", score: 5 },
    { id: "c", name: "carol", score: 1 },
  ];
  type Row = (typeof rows)[number];
  type Col = "name" | "score";
  const getSortValue = (row: Row, col: Col) => (col === "name" ? row.name.toLowerCase() : row.score);

  it("returns rows unchanged when sort is null", () => {
    expect(sortRows(rows, getSortValue, null)).toBe(rows);
  });

  it("sorts strings ascending, case-insensitively", () => {
    const sorted = sortRows(rows, getSortValue, { column: "name", direction: "asc" });
    expect(sorted.map((r) => r.id)).toEqual(["a", "b", "c"]);
  });

  it("sorts numbers descending", () => {
    const sorted = sortRows(rows, getSortValue, { column: "score", direction: "desc" });
    expect(sorted.map((r) => r.id)).toEqual(["a", "b", "c"]);
  });

  it("does not mutate the input array", () => {
    const original = [...rows];
    sortRows(rows, getSortValue, { column: "score", direction: "asc" });
    expect(rows).toEqual(original);
  });
});

describe("nextTableSort", () => {
  const nameAsc: SortConfig<"name" | "date"> = { column: "name", direction: "asc" };
  const dateDesc: SortConfig<"name" | "date"> = { column: "date", direction: "desc" };

  it("uses the tri-state cycle when there is no default", () => {
    expect(nextTableSort(null, null, "name")).toEqual({ column: "name", direction: "asc" });
    expect(nextTableSort({ column: "name", direction: "asc" }, null, "name")).toEqual({
      column: "name",
      direction: "desc",
    });
    expect(nextTableSort({ column: "name", direction: "desc" }, null, "name")).toBeNull();
  });

  it("flips an ascending default column to descending on the first click", () => {
    expect(nextTableSort(null, nameAsc, "name")).toEqual({ column: "name", direction: "desc" });
  });

  it("flips a descending default column to ascending on the first click", () => {
    expect(nextTableSort(null, dateDesc, "date")).toEqual({ column: "date", direction: "asc" });
  });

  it("returns to the default (null) on the second click of the default column", () => {
    expect(nextTableSort({ column: "name", direction: "desc" }, nameAsc, "name")).toBeNull();
    expect(nextTableSort({ column: "date", direction: "asc" }, dateDesc, "date")).toBeNull();
  });

  it("returns to the default view when clicking the default column from another column", () => {
    expect(nextTableSort({ column: "name", direction: "asc" }, dateDesc, "date")).toBeNull();
  });

  it("uses the tri-state cycle for non-default columns, clearing back to the default", () => {
    expect(nextTableSort(null, dateDesc, "name")).toEqual({ column: "name", direction: "asc" });
    expect(nextTableSort({ column: "name", direction: "asc" }, dateDesc, "name")).toEqual({
      column: "name",
      direction: "desc",
    });
    expect(nextTableSort({ column: "name", direction: "desc" }, dateDesc, "name")).toBeNull();
  });
});

describe("sortRows with date values", () => {
  type DateRow = { id: string; value: SortValue };
  const byValue = (row: DateRow) => row.value;
  const ids = (sorted: DateRow[]) => sorted.map((r) => r.id);
  const asc = { column: "value", direction: "asc" } as const;
  const desc = { column: "value", direction: "desc" } as const;

  it("sorts date-only YYYY-MM-DD strings chronologically", () => {
    const rows: DateRow[] = [
      { id: "b", value: "2024-11-05" },
      { id: "c", value: "2025-01-15" },
      { id: "a", value: "2023-09-30" },
    ];
    expect(ids(sortRows(rows, byValue, asc))).toEqual(["a", "b", "c"]);
    expect(ids(sortRows(rows, byValue, desc))).toEqual(["c", "b", "a"]);
  });

  it("sorts ISO timestamps by instant, not lexically, across offsets and precision", () => {
    const rows: DateRow[] = [
      // 08:00Z — lexically largest, chronologically earliest
      { id: "early", value: "2024-01-05T10:00:00+02:00" },
      { id: "late", value: "2024-01-05T09:30:00.500Z" },
      { id: "mid", value: "2024-01-05T09:00:00+00:00" },
    ];
    expect(ids(sortRows(rows, byValue, asc))).toEqual(["early", "mid", "late"]);
    expect(ids(sortRows(rows, byValue, desc))).toEqual(["late", "mid", "early"]);
  });

  it("orders a mix of date-only strings and timestamps chronologically", () => {
    const rows: DateRow[] = [
      { id: "ts-2024", value: "2024-06-01T12:00:00Z" },
      { id: "d-2023", value: "2023-12-31" },
      { id: "d-2025", value: "2025-01-01" },
    ];
    expect(ids(sortRows(rows, byValue, asc))).toEqual(["d-2023", "ts-2024", "d-2025"]);
  });

  it("sorts Date objects chronologically", () => {
    const rows: DateRow[] = [
      { id: "b", value: new Date("2024-03-01T00:00:00Z") },
      { id: "a", value: new Date("2022-03-01T00:00:00Z") },
      { id: "c", value: new Date("2026-03-01T00:00:00Z") },
    ];
    expect(ids(sortRows(rows, byValue, asc))).toEqual(["a", "b", "c"]);
    expect(ids(sortRows(rows, byValue, desc))).toEqual(["c", "b", "a"]);
  });

  it("sorts null, undefined, NaN and invalid dates last in both directions", () => {
    const rows: DateRow[] = [
      { id: "null", value: null },
      { id: "2024", value: "2024-05-01" },
      { id: "undef", value: undefined },
      { id: "2022", value: "2022-05-01" },
      { id: "nan", value: NaN },
      { id: "invalid", value: new Date("not a date") },
      { id: "2023", value: "2023-05-01" },
    ];
    const missing = ["null", "undef", "nan", "invalid"];
    expect(ids(sortRows(rows, byValue, asc))).toEqual(["2022", "2023", "2024", ...missing]);
    expect(ids(sortRows(rows, byValue, desc))).toEqual(["2024", "2023", "2022", ...missing]);
  });

  it("treats Infinity sentinels as equal to each other instead of producing NaN", () => {
    const rows: DateRow[] = [
      { id: "inf1", value: Infinity },
      { id: "two", value: 2 },
      { id: "inf2", value: Infinity },
      { id: "one", value: 1 },
    ];
    expect(ids(sortRows(rows, byValue, asc))).toEqual(["one", "two", "inf1", "inf2"]);
  });

  it("still compares non-date strings with localeCompare", () => {
    const rows: DateRow[] = [
      { id: "b", value: "banana" },
      { id: "a", value: "apple" },
      { id: "n", value: "2024 notes" },
    ];
    expect(ids(sortRows(rows, byValue, asc))).toEqual(["n", "a", "b"]);
  });
});

describe("compareSortValues", () => {
  it("never lets a missing value precede a present one", () => {
    expect(compareSortValues(null, "2024-01-01", "asc")).toBeGreaterThan(0);
    expect(compareSortValues(null, "2024-01-01", "desc")).toBeGreaterThan(0);
    expect(compareSortValues("2024-01-01", undefined, "desc")).toBeLessThan(0);
    expect(compareSortValues(null, undefined, "asc")).toBe(0);
  });
});
