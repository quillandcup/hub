import { describe, it, expect } from "vitest";
import { isValidDay, parseAccessDuration, parseMigrateArgs } from "@/lib/courses/migrate-args";

describe("parseMigrateArgs", () => {
  it("needs a course, and takes defaults for everything else", () => {
    expect(parseMigrateArgs(["--course", "123"])).toEqual({
      ok: true,
      courseId: "123",
      envFile: ".env.local",
      baseUrl: null,
      yes: false,
      accessDuration: undefined,
      launchOn: undefined,
      skipDrafts: false,
      skipProgress: false,
      skipComments: false,
    });
  });

  it("reads every option, with = or a space", () => {
    expect(
      parseMigrateArgs(["--course=9", "--env", ".env.prod", "--base-url", "https://hub.example.com/", "--yes", "--access-duration=1 year", "--launch-on", "2026-12-01", "--skip-drafts", "--skip-progress", "--skip-comments"])
    ).toEqual({
      ok: true,
      courseId: "9",
      envFile: ".env.prod",
      baseUrl: "https://hub.example.com",
      yes: true,
      accessDuration: "1 year",
      launchOn: "2026-12-01",
      skipDrafts: true,
      skipProgress: true,
      skipComments: true,
    });
  });

  it("maps lifetime to null", () => {
    expect(parseMigrateArgs(["--course", "1", "--access-duration", "lifetime"])).toMatchObject({ ok: true, accessDuration: null });
  });

  it.each([
    [[], /--course .* is required/],
    [["--course"], /--course needs a value/],
    [["--course", "--yes"], /--course needs a value/],
    [["--course", "abc"], /digits only/],
    [["--course", "1", "--course", "2"], /more than once/],
    [["--course", "1", "--nope"], /Unknown option --nope/],
    [["--course", "1", "stray"], /Unexpected argument/],
    [["--course", "1", "--yes=1"], /takes no value/],
    [["--course", "1", "--access-duration", "soon"], /--access-duration must be/],
    [["--course", "1", "--access-duration", "0 years"], /--access-duration must be/],
    [["--course", "1", "--launch-on", "12/01/2026"], /YYYY-MM-DD/],
    [["--course", "1", "--launch-on", "2026-02-30"], /YYYY-MM-DD/],
    [["--course", "1", "--base-url", "hub.example.com"], /full http\(s\) address/],
    [["--course", "1", "--base-url", "ftp://hub.example.com"], /full http\(s\) address/],
  ])("rejects %j", (argv, error) => {
    const parsed = parseMigrateArgs(argv as string[]);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toMatch(error as RegExp);
  });
});

describe("parseAccessDuration", () => {
  it("normalises intervals", () => {
    expect(parseAccessDuration("1 year")).toBe("1 year");
    expect(parseAccessDuration("6 Months")).toBe("6 months");
    expect(parseAccessDuration("2year")).toBe("2 years");
    expect(parseAccessDuration(" Lifetime ")).toBeNull();
    expect(parseAccessDuration("forever")).toBeUndefined();
  });
});

describe("isValidDay", () => {
  it("accepts only real days", () => {
    expect(isValidDay("2028-02-29")).toBe(true);
    expect(isValidDay("2027-02-29")).toBe(false);
    expect(isValidDay("2027-1-1")).toBe(false);
  });
});
