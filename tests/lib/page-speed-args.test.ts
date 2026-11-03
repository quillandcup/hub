import { describe, expect, it } from "vitest";
import { DEFAULT_ROUTES, formatRecord, formatTable, parsePageSpeedArgs, summaryByRoute } from "../../scripts/page-speed-args";

const NOW = new Date("2026-11-03T12:00:00Z");

describe("parsePageSpeedArgs", () => {
  it("defaults to the last 24 hours in 1h buckets over the member routes", () => {
    expect(parsePageSpeedArgs([], NOW)).toEqual({
      from: "2026-11-02T12:00:00.000Z",
      to: "2026-11-03T12:00:00.000Z",
      granularity: "1h",
      routes: DEFAULT_ROUTES,
      label: null,
      record: false,
    });
  });

  it("reads a window, granularity, routes, label and --record", () => {
    const args = parsePageSpeedArgs(["--from", "2026-11-03T03:50:00Z", "--to", "2026-11-03T04:50:00Z", "--granularity", "5m", "--routes", "/a, /b", "--label", "after", "--record"], NOW);
    expect(args).toMatchObject({ from: "2026-11-03T03:50:00Z", to: "2026-11-03T04:50:00Z", granularity: "5m", routes: ["/a", "/b"], label: "after", record: true });
  });

  it.each([
    [["--from", "yesterday"], /--from must be a date/],
    [["--from", "2026-11-04T00:00:00Z"], /before --to/],
    [["--granularity", "2h"], /--granularity must be one of/],
    [["--bogus", "1"], /Unknown option --bogus/],
    [["--label"], /needs a value/],
    [["stray"], /Unexpected argument/],
  ])("refuses %j", (argv, message) => {
    expect(() => parsePageSpeedArgs(argv, NOW)).toThrow(message);
  });
});

describe("summaryByRoute", () => {
  it("maps each route to its value and skips the hint line before the JSON", () => {
    const output = `<hint />\n${JSON.stringify({ summary: [{ route: "/dashboard", vercel_x_p75: 92 }, { route: "/login", vercel_x_p75: 1316 }] })}`;
    expect(summaryByRoute(output)).toEqual(new Map([["/dashboard", 92], ["/login", 1316]]));
  });

  it("is empty when the window had no traffic", () => {
    expect(summaryByRoute(JSON.stringify({ query: {} }))).toEqual(new Map());
  });

  it("throws when there is no JSON at all", () => {
    expect(() => summaryByRoute("error: not logged in")).toThrow("No JSON");
  });
});

describe("formatTable and formatRecord", () => {
  const table = formatTable([
    { route: "/dashboard", requests: 1106, serverP50: 20.6, serverP75: 92, visits: 52, fcpP75: 2744, lcpP75: 2900, ttfbP75: 170 },
    { route: "/settings", requests: 4, serverP50: undefined, serverP75: undefined, visits: undefined, fcpP75: undefined, lcpP75: undefined, ttfbP75: undefined },
  ]);

  it("rounds milliseconds and shows a dash where there is no data", () => {
    expect(table).toContain("| `/dashboard` | 1106 | 21 | 92 | 52 | 2744 | 2900 | 170 |");
    expect(table).toContain("| `/settings` | 4 | - | - | - | - | - | - |");
  });

  it("heads the record with the label, the window and the commit", () => {
    const args = parsePageSpeedArgs(["--from", "2026-11-03T03:50:00Z", "--label", "after #909", "--to", "2026-11-03T05:00:00Z"], NOW);
    const record = formatRecord(args, table, "abc1234");
    expect(record).toContain("### after #909");
    expect(record).toContain("Window 2026-11-03T03:50:00Z to 2026-11-03T05:00:00Z (UTC, 1h buckets); recorded with production at abc1234.");
    expect(formatRecord(args, table, null)).not.toContain("production at");
  });
});
