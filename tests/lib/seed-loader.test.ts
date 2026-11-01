import { describe, expect, it } from "vitest";
import { assertSeedTarget, SEED_NON_LOCAL_FLAG } from "@/lib/data/seed-loader";
import { parseArgs } from "@/scripts/seed-local";

describe("assertSeedTarget", () => {
  it("accepts a local Supabase", () => {
    expect(() => assertSeedTarget("http://127.0.0.1:54321", {})).not.toThrow();
    expect(() => assertSeedTarget("http://localhost:54321", {})).not.toThrow();
    expect(() => assertSeedTarget("http://[::1]:54321", {})).not.toThrow();
  });

  it("refuses anything else, however it is spelled", () => {
    expect(() => assertSeedTarget("https://project-ref.supabase.co", {})).toThrow(/only load into a local database/);
    expect(() => assertSeedTarget("http://127.0.0.1.example.com", {})).toThrow(/Refusing to seed/);
    expect(() => assertSeedTarget("not a url", {})).toThrow(/not a URL/);
    expect(() => assertSeedTarget(undefined, {})).toThrow(/No Supabase URL/);
  });

  it("lets an explicit flag allow another database, and only the exact value", () => {
    expect(() => assertSeedTarget("https://staging.example.com", { [SEED_NON_LOCAL_FLAG]: "1" })).not.toThrow();
    expect(() => assertSeedTarget("https://staging.example.com", { [SEED_NON_LOCAL_FLAG]: "true" })).toThrow();
  });
});

describe("seed:local arguments", () => {
  it("reads the profile, a fixed moment and --clear", () => {
    expect(parseArgs(["--profile", "lapsing", "--now", "2026-10-24T20:00:00Z", "--clear"])).toEqual({
      profile: "lapsing",
      now: new Date("2026-10-24T20:00:00Z"),
      clear: true,
    });
  });

  it("defaults to now and no clear, and rejects a date it cannot read", () => {
    const parsed = parseArgs(["--profile", "first-week"]);

    expect(parsed.clear).toBe(false);
    expect(Math.abs(parsed.now.getTime() - Date.now())).toBeLessThan(5_000);
    expect(() => parseArgs(["--now", "yesterday-ish"])).toThrow(/not a date/);
  });
});
