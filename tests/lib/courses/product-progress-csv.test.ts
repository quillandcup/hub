import { describe, it, expect } from "vitest";
import { parseProductProgressCsv, ProgressCsvError } from "@/lib/courses/product-progress-csv";

const HEADER = "Name,Email,Product Progress,Logins,Start Date,Last Activity At";

describe("parseProductProgressCsv", () => {
  it("reads a plain report", () => {
    const parsed = parseProductProgressCsv(`${HEADER}\nAda Example,ada@example.com,62,14,2026-01-05,2026-02-10\n`);
    expect(parsed).toEqual({
      rowsRead: 1,
      invalid: [],
      rows: [{ email: "ada@example.com", percent: 62, logins: 14, startedOn: "2026-01-05", lastActivityOn: "2026-02-10" }],
    });
  });

  it("tolerates a BOM, CRLF line endings and no trailing newline", () => {
    const parsed = parseProductProgressCsv(`﻿${HEADER}\r\nAda Example,ada@example.com,5,1,2026-01-05,2026-01-06\r\nBo Example,bo@example.com,100,2,2026-01-05,2026-01-07`);
    expect(parsed.rows.map((r) => r.email)).toEqual(["ada@example.com", "bo@example.com"]);
    expect(parsed.invalid).toEqual([]);
  });

  it("accepts a percent with a % sign, spaces or decimals", () => {
    const parsed = parseProductProgressCsv(`${HEADER}\nA,a@example.com,62%,1,,\nB,b@example.com, 12.5 % ,1,,\nC,c@example.com,33.456,1,,\nD,d@example.com,0,0,,`);
    expect(parsed.rows.map((r) => r.percent)).toEqual([62, 12.5, 33.46, 0]);
  });

  it("treats Not Started, blank and missing dates as null", () => {
    const parsed = parseProductProgressCsv(`${HEADER}\nA,a@example.com,0,0,Not Started,Not Started\nB,b@example.com,0,0,,\nC,c@example.com,0\nD,d@example.com,0,0,-,N/A`);
    expect(parsed.invalid).toEqual([]);
    for (const row of parsed.rows) expect([row.startedOn, row.lastActivityOn]).toEqual([null, null]);
    expect(parsed.rows[2].logins).toBeNull();
  });

  it("cuts a date-time to its date", () => {
    const parsed = parseProductProgressCsv(`${HEADER}\nA,a@example.com,1,1,2026-03-04T10:20:30Z,2026-03-05 08:00:00`);
    expect(parsed.rows[0]).toMatchObject({ startedOn: "2026-03-04", lastActivityOn: "2026-03-05" });
  });

  it("reads quoted fields with commas, quotes and line breaks", () => {
    const parsed = parseProductProgressCsv(`${HEADER}\n"Example, Ada ""Ace""",ada@example.com,50,3,2026-01-01,2026-01-02\n"Multi\nLine",bo@example.com,10,1,2026-01-01,2026-01-02`);
    expect(parsed.rows.map((r) => r.email)).toEqual(["ada@example.com", "bo@example.com"]);
    expect(parsed.invalid).toEqual([]);
  });

  it("finds columns by name, case-insensitively, in any order, ignoring extra columns", () => {
    const parsed = parseProductProgressCsv("last activity at,EXTRA,product progress,email, Logins ,start date\n2026-02-02,x,40,Ada@Example.com ,7,2026-01-01");
    expect(parsed.rows).toEqual([{ email: "ada@example.com", percent: 40, logins: 7, startedOn: "2026-01-01", lastActivityOn: "2026-02-02" }]);
  });

  it("works with only Email and Product Progress", () => {
    const parsed = parseProductProgressCsv("Email,Product Progress\nada@example.com,9");
    expect(parsed.rows).toEqual([{ email: "ada@example.com", percent: 9, logins: null, startedOn: null, lastActivityOn: null }]);
  });

  it("skips blank lines without counting them", () => {
    const parsed = parseProductProgressCsv(`${HEADER}\n\n,,,,,\nAda,ada@example.com,1,1,,\n\n`);
    expect(parsed.rowsRead).toBe(1);
  });

  it("fails clearly when Email or Product Progress is missing, or the file is empty", () => {
    expect(() => parseProductProgressCsv("Name,Product Progress\nA,1")).toThrow(/Missing the Email column/);
    expect(() => parseProductProgressCsv("Name,Email\nA,a@example.com")).toThrow(/Missing the Product Progress column/);
    expect(() => parseProductProgressCsv("Name,Logins\nA,1")).toThrow(/Email and Product Progress/);
    expect(() => parseProductProgressCsv("")).toThrow(ProgressCsvError);
    expect(() => parseProductProgressCsv("\n\n")).toThrow(/empty/);
  });

  it("reports invalid rows with line numbers and reasons, never their content", () => {
    const text = [
      HEADER,
      "Ada,ada@example.com,50,1,2026-01-01,2026-01-02",
      "Bo,not-an-email,50,1,,",
      "Cy,cy@example.com,150,1,,",
      "Di,di@example.com,abc,1,,",
      "Ed,ed@example.com,,1,,",
      "Fa,fa@example.com,10,x,,",
      "Gi,gi@example.com,10,1,2026-13-45,",
      "Hu,hu@example.com,10,1,,tomorrow",
      ",,,5,,",
      "Ada again,ADA@example.com,60,1,,",
    ].join("\n");
    const parsed = parseProductProgressCsv(text);
    expect(parsed.rowsRead).toBe(10);
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.invalid.map((i) => i.line)).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(parsed.invalid.map((i) => i.reason)).toEqual([
      "Email is not a valid address",
      "Product Progress is not a percentage from 0 to 100",
      "Product Progress is not a percentage from 0 to 100",
      "Product Progress is missing",
      "Logins is not a whole number",
      "Start Date is not a date (expected YYYY-MM-DD, or Not Started)",
      "Last Activity At is not a date (expected YYYY-MM-DD)",
      "Email is missing",
      "Email appears more than once in the file",
    ]);
    expect(JSON.stringify(parsed.invalid)).not.toMatch(/example\.com|Ada|Bo\b/);
  });

  it("counts lines past a quoted line break", () => {
    const parsed = parseProductProgressCsv(`${HEADER}\n"Two\nLines",ada@example.com,50,1,,\nBo,bad,5,1,,`);
    expect(parsed.invalid).toEqual([{ line: 4, reason: "Email is not a valid address" }]);
  });
});
