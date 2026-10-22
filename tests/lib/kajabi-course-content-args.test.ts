import { describe, it, expect } from "vitest";
import { parseContentArgs } from "@/scripts/kajabi-course-content-args";

describe("parseContentArgs", () => {
  it("defaults to a dry run against .env.local, skipping drafts", () => {
    expect(parseContentArgs(["--course", "123"])).toEqual({
      ok: true,
      scope: { courseId: "123" },
      envFile: ".env.local",
      apply: false,
      includeDrafts: false,
      concurrency: 2,
      headless: false,
      profileDir: null,
    });
  });

  it("takes values with = or a space, and the boolean flags", () => {
    expect(parseContentArgs(["--lesson=55", "--env", ".env.prod", "--apply", "--include-drafts", "--concurrency=4", "--headless"])).toMatchObject({
      ok: true,
      scope: { lessonId: "55" },
      envFile: ".env.prod",
      apply: true,
      includeDrafts: true,
      concurrency: 4,
      headless: true,
    });
  });

  it.each([
    [[], "Give --course or --lesson"],
    [["--course", "1", "--lesson", "2"], "not both"],
    [["--course"], "--course needs a value"],
    [["--course", "--apply"], "--course needs a value"],
    [["--course", "1", "--course", "2"], "more than once"],
    [["--course", "1", "--apply=yes"], "takes no value"],
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
});
