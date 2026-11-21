import { describe, it, expect } from "vitest";
import { fetchRowWindow } from "@/lib/supabase/paginate";

describe("fetchRowWindow", () => {
  const table = Array.from({ length: 2500 }, (_, i) => i);
  const calls: [number, number][] = [];
  // Like Supabase: never more than 1000 rows per request.
  const query = async (from: number, to: number) => {
    calls.push([from, to]);
    return { data: table.slice(from, Math.min(to, from + 999) + 1), error: null };
  };

  it("reads a window larger than one request, in order and without repeats", async () => {
    calls.length = 0;
    expect(await fetchRowWindow(500, 2000, query)).toEqual(table.slice(500, 2500));
    expect(calls).toEqual([
      [500, 1499],
      [1500, 2499],
    ]);
  });

  it("asks for exactly the window, not a full batch past it", async () => {
    calls.length = 0;
    expect(await fetchRowWindow(0, 1001, query)).toEqual(table.slice(0, 1001));
    expect(calls).toEqual([
      [0, 999],
      [1000, 1000],
    ]);
  });

  it("stops at the first short batch", async () => {
    calls.length = 0;
    expect(await fetchRowWindow(2400, 5000, query)).toEqual(table.slice(2400));
    expect(calls).toHaveLength(1);
  });

  it("returns nothing for a window past the end, and throws a database error", async () => {
    expect(await fetchRowWindow(9000, 10, query)).toEqual([]);
    await expect(fetchRowWindow(0, 10, async () => ({ data: null, error: { message: "boom" } }))).rejects.toThrow("boom");
  });
});
