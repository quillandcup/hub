import { describe, it, expect } from "vitest";
import { nextSortConfig, sortRows, type SortConfig } from "@/lib/hooks/useTableSort";

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
