import { describe, it, expect } from "vitest";
import { parseContentArgs } from "@/scripts/kajabi-course-content-args";

describe("parseContentArgs", () => {
  it("defaults to a dry run against .env.local, capturing drafts too", () => {
    expect(parseContentArgs(["--course", "123"])).toEqual({
      ok: true,
      scope: { courseId: "123" },
      envFile: ".env.local",
      apply: false,
      skipDrafts: false,
      progress: false,
      hero: false,
      probe: null,
      concurrency: 2,
      headless: false,
      profileDir: null,
    });
  });

  it("takes values with = or a space, and the boolean flags", () => {
    expect(parseContentArgs(["--lesson=55", "--env", ".env.prod", "--apply", "--skip-drafts", "--concurrency=4", "--headless", "--hero"])).toMatchObject({
      ok: true,
      scope: { lessonId: "55" },
      envFile: ".env.prod",
      apply: true,
      skipDrafts: true,
      hero: true,
      concurrency: 4,
      headless: true,
    });
  });

  it("--progress needs a course and excludes the lesson-content options", () => {
    expect(parseContentArgs(["--course", "123", "--progress", "--apply"])).toMatchObject({ ok: true, progress: true, apply: true, scope: { courseId: "123" } });
    expect(parseContentArgs(["--progress"])).toMatchObject({ ok: false, error: expect.stringContaining("--progress needs --course") });
    expect(parseContentArgs(["--lesson", "5", "--progress"])).toMatchObject({ ok: false });
    expect(parseContentArgs(["--course", "1", "--progress", "--hero"])).toMatchObject({ ok: false, error: expect.stringContaining("--progress captures progress only") });
    expect(parseContentArgs(["--course", "1", "--progress", "--skip-drafts"])).toMatchObject({ ok: false });
  });

  it.each([
    [[], "Give --course, --lesson or --probe"],
    [["--course", "1", "--lesson", "2"], "not both"],
    [["--course"], "--course needs a value"],
    [["--course", "--apply"], "--course needs a value"],
    [["--course", "1", "--course", "2"], "more than once"],
    [["--course", "1", "--apply=yes"], "takes no value"],
    [["--course", "1", "--skip-drafts", "--include-drafts"], "not both"],
    [["--course", "1", "--nope"], "Unknown option --nope"],
    [["--course", "1", "stray"], 'Unexpected argument "stray"'],
    [["--course", "1", "--concurrency", "0"], "from 1 to 5"],
    [["--course", "1", "--concurrency", "9"], "from 1 to 5"],
    [["--course", "1", "--concurrency", "two"], "from 1 to 5"],
  ])("rejects %j", (argv, message) => {
    const result = parseContentArgs(argv);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toContain(message);
  });

  it("takes a page to probe instead of a course or lesson, which then needs no scope", () => {
    expect(parseContentArgs(["--probe", "https://app.kajabi.com/admin/x"])).toMatchObject({
      ok: true,
      scope: null,
      probe: { url: "https://app.kajabi.com/admin/x", seconds: 90 },
    });
    expect(parseContentArgs(["--probe=https://app.kajabi.com/admin/x", "--seconds=30"])).toMatchObject({ probe: { seconds: 30 } });
    expect(parseContentArgs(["--course", "1"])).toMatchObject({ probe: null, scope: { courseId: "1" } });
  });

  it.each([
    [["--probe", "https://k.test/a", "--course", "1"], "not --course or --lesson"],
    [["--probe", "http://k.test/a"], "https://"],
    [["--probe", "not a url"], "https://"],
    [["--probe", "https://k.test/a", "--seconds", "5"], "10 to 600"],
    [["--probe", "https://k.test/a", "--seconds", "abc"], "10 to 600"],
    [["--course", "1", "--seconds", "30"], "is for --probe"],
  ])("rejects %j", (argv, message) => {
    const result = parseContentArgs(argv);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toContain(message);
  });
});
