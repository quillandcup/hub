import { describe, it, expect } from "vitest";
import { parseSyncArgs, SYNC_USAGE } from "@/scripts/sync-args";

const known = {
  names: new Set(["CHECKLY_HEARTBEAT_MEMBER_REMINDERS", "SLACK_BOT_TOKEN", "NEXT_PUBLIC_SUPABASE_URL"]),
  targets: ["preview", "production"],
};
const parse = (...argv: string[]) => parseSyncArgs(argv, known);

describe("parseSyncArgs", () => {
  it("syncs everything when there are no arguments", () => {
    expect(parse()).toEqual({ ok: true, only: null, targets: null });
  });

  it("scopes to a variable with --only=NAME", () => {
    expect(parse("--only=SLACK_BOT_TOKEN")).toEqual({ ok: true, only: new Set(["SLACK_BOT_TOKEN"]), targets: null });
  });

  it("takes the space form too, which used to be ignored and sync every variable", () => {
    expect(parse("--only", "CHECKLY_HEARTBEAT_MEMBER_REMINDERS")).toEqual({
      ok: true,
      only: new Set(["CHECKLY_HEARTBEAT_MEMBER_REMINDERS"]),
      targets: null,
    });
  });

  it("takes several names, with or without spaces around the commas", () => {
    const result = parse("--only=SLACK_BOT_TOKEN, NEXT_PUBLIC_SUPABASE_URL");
    expect(result).toEqual({ ok: true, only: new Set(["SLACK_BOT_TOKEN", "NEXT_PUBLIC_SUPABASE_URL"]), targets: null });
  });

  it("scopes to targets, in either spelling, and combines with --only", () => {
    expect(parse("--target=production")).toEqual({ ok: true, only: null, targets: new Set(["production"]) });
    expect(parse("--only=SLACK_BOT_TOKEN", "--target", "preview,production")).toEqual({
      ok: true,
      only: new Set(["SLACK_BOT_TOKEN"]),
      targets: new Set(["preview", "production"]),
    });
  });

  it("refuses a variable that isn't synced to Vercel instead of syncing nothing", () => {
    const result = parse("--only=CHECKLY_HEARTBEAT_ONBOARDING_NUDGES");
    expect(result).toMatchObject({ ok: false });
    expect((result as { error: string }).error).toContain("CHECKLY_HEARTBEAT_ONBOARDING_NUDGES");
    expect((result as { error: string }).error).toContain("up to date");
  });

  it("names every unknown variable in a list, even when some are fine", () => {
    const result = parse("--only=SLACK_BOT_TOKEN,NOPE_ONE,NOPE_TWO");
    expect((result as { error: string }).error).toContain("NOPE_ONE, NOPE_TWO");
    expect((result as { error: string }).error).not.toContain("SLACK_BOT_TOKEN");
  });

  it("refuses an unknown target", () => {
    expect(parse("--target=staging")).toEqual({ ok: false, error: "Unknown target: staging (expected preview or production)" });
  });

  it.each([
    ["an unknown option", ["--only-ish=X"], "Unknown option --only-ish=X"],
    ["a single-dash option", ["-o", "X"], "Unknown option -o"],
    ["a stray argument", ["SLACK_BOT_TOKEN"], 'Unexpected argument "SLACK_BOT_TOKEN"'],
    ["a flag with no value", ["--only"], "--only needs a value"],
    ["a flag followed by another flag", ["--only", "--target=preview"], "--only needs a value"],
    ["an empty value", ["--only="], "--only has an empty name"],
    ["an empty name in a list", ["--only=SLACK_BOT_TOKEN,"], "--only has an empty name"],
    ["a repeated flag", ["--only=SLACK_BOT_TOKEN", "--only=NEXT_PUBLIC_SUPABASE_URL"], "--only given more than once"],
  ])("refuses %s", (_label, argv, error) => {
    expect(parse(...argv)).toEqual({ ok: false, error });
  });

  it("describes both flags in its usage text", () => {
    expect(SYNC_USAGE).toContain("--only");
    expect(SYNC_USAGE).toContain("--target");
  });

  it("ignores the bare -- pnpm passes ahead of the flags", () => {
    expect(parse("--", "--only=SLACK_BOT_TOKEN")).toEqual({ ok: true, only: new Set(["SLACK_BOT_TOKEN"]), targets: null });
  });

  it("names the destination in the error, and has no --target when there are no targets (GitHub)", () => {
    const github = { names: known.names, targets: [], destination: "GitHub" };
    expect(parseSyncArgs(["--only=NOPE"], github)).toMatchObject({ ok: false, error: expect.stringContaining("synced to GitHub: NOPE") });
    expect(parseSyncArgs(["--target=production"], github)).toEqual({ ok: false, error: "Unknown option --target=production" });
  });
});
