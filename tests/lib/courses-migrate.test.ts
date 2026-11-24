import { describe, it, expect } from "vitest";
import { buildSteps, formatSummary, parseCommentsSummary, parseContentSummary, parseProgressSummary, resolveEnvironment, runMigration, LOCAL_APP_URL, type MigrateIO, type MigrateStep } from "@/lib/courses/migrate";
import { formatCommentsTotals, formatContentTotals, formatProgressTotals } from "@/lib/kajabi/capture-totals";
import { parseMigrateArgs, type MigrateArgs } from "@/lib/courses/migrate-args";

const SECRET = "s3cret-token";
const ENV = { baseUrl: "https://hub.example.com", secret: SECRET };

/** The older tests are about the required steps, so the optional captures are left out unless a test asks for them (`withOptional`). */
function args(extra: string[] = []): MigrateArgs {
  return withOptional(["--skip-progress", "--skip-comments", ...extra]);
}

function withOptional(extra: string[] = []): MigrateArgs {
  const parsed = parseMigrateArgs(["--course", "42", ...extra]);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed;
}

const totals = (u: number, l: number, quizzes = 1, f = 0) => ({
  updated: u, urlsRefreshed: l, unchanged: 5, missing: 0, failed: f, quizzes: { total: quizzes, created: 0, updated: quizzes, unchanged: 0, noQuestionRead: 0 },
});
// Built by the same functions the capture script prints with, so the parser is tested against the real text.
const CONTENT_LINE = (u: number, l: number, q = 1, f = 0) => formatContentTotals(true, totals(u, l, q, f));
const DRY_LINE = (u: number, l: number) => formatContentTotals(false, totals(u, l));
// A dry run with nothing to write: the quiz is there, and unchanged.
const NOTHING_NEW = formatContentTotals(false, { updated: 0, urlsRefreshed: 0, unchanged: 5, missing: 0, failed: 0, quizzes: { total: 1, created: 0, updated: 0, unchanged: 1, noQuestionRead: 0 } });
const quizLine = (created: number, changed: number, u = 0, l = 0) =>
  formatContentTotals(false, { updated: u, urlsRefreshed: l, unchanged: 53, missing: 0, failed: 0, quizzes: { total: created + changed, created, updated: changed, unchanged: 0, noQuestionRead: 0 } });

interface Call { path: string; body: any; auth: string | null }

interface World {
  /** Responses keyed "path" or "path:action"; a function is called each time with the call number. */
  routes: Record<string, any>;
  answers?: string[];
  confirms?: boolean[];
  content?: { code: number; output: string }[];
}

function harness(world: World) {
  const calls: Call[] = [];
  const asked: string[] = [];
  const confirmed: string[] = [];
  const contentRuns: string[][] = [];
  const logs: string[] = [];
  const counts = new Map<string, number>();
  const answers = [...(world.answers ?? [])];
  const confirms = [...(world.confirms ?? [])];
  const content = [...(world.content ?? [])];

  const io: MigrateIO = {
    fetch: (async (url: string, init: RequestInit) => {
      const path = new URL(url).pathname;
      const body = JSON.parse(String(init.body));
      calls.push({ path, body, auth: (init.headers as Record<string, string>).Authorization ?? null });
      const key = body.action ? `${path}:${body.action}` : path;
      const n = (counts.get(key) ?? 0) + 1;
      counts.set(key, n);
      const route = world.routes[key];
      if (route === undefined) throw new Error(`unexpected call ${key}`);
      const value = typeof route === "function" ? route(n, body) : route;
      if (value instanceof Error) throw value;
      const status = value?.status ?? 200;
      return new Response(JSON.stringify(value?.json ?? value), { status });
    }) as unknown as typeof fetch,
    confirm: async (q) => {
      confirmed.push(q);
      return confirms.length ? confirms.shift()! : true;
    },
    ask: async (q) => {
      asked.push(q);
      return answers.shift() ?? "";
    },
    runContent: async (a) => {
      contentRuns.push(a);
      return content.shift() ?? { code: 0, output: "" };
    },
    log: (line) => logs.push(line),
  };
  return { io, calls, asked, confirmed, contentRuns, logs, paths: () => calls.map((c) => (c.body.action ? `${c.path}:${c.body.action}` : c.path)) };
}

const A_OK = { courses: [{ id: "42", title: "Demo Course", modules: 3, lessons: 12, offers: 1, unplacedLessons: 0 }] };
const courseEntry = (over: Record<string, unknown> = {}) => ({
  slug: "demo-course", kajabiId: "42", isDraft: false, accessDuration: "1 year", launchAt: null, modules: 3, lessons: 12, comingSoon: 0, hiddenLessons: 0, deleted: { modules: 0, lessons: 0 }, access: { members: 7, removed: 0 }, ...over,
});
const FILES_OK = { success: true, copied: [{ kajabiFileId: "f1", filename: "a.pdf", bytes: 1 }], alreadyCopied: 2, removed: 0, needsNewLink: [], waitingForLesson: 0, failed: [], images: { copied: 3, alreadyCopied: 0, removed: 0, failed: [] } };
const video = (id: string, state: string, over: Record<string, unknown> = {}) => ({ mediaId: id, draft: false, state, durationSeconds: 600, videoStatus: null, lessonTitles: [id], ...over });

const COMMENTS_ROUTE = (inserted: number, over: Record<string, unknown> = {}) => ({
  success: true,
  courses: [{ slug: "demo-course", inserted, updated: 0, unchanged: 2, replies: 1, orphanReplies: 0, authors: { matched: 3, staff: 1, unmatched: 1, ambiguous: 1 }, unmatchedAuthorComments: 2, ambiguousAuthorComments: 1, unmatchedAuthors: [{ name: "Nobody Known", comments: 2 }], ambiguousAuthors: [{ name: "Cy Twin", comments: 1, members: 2 }], unmatchedLessonComments: 1, skipped: 0, ...over }],
});

const baseRoutes = (over: Record<string, any> = {}) => ({
  "/api/import/kajabi-courses": A_OK,
  "/api/process/courses": { courses: [courseEntry()] },
  "/api/process/course-progress": { success: true, courses: [{ slug: "demo-course", inserted: 0, alreadyCompleted: 0, leftAlone: 0 }] },
  "/api/process/course-comments": COMMENTS_ROUTE(0),
  "/api/process/course-files": FILES_OK,
  "/api/process/course-media:plan": { videos: [] },
  ...over,
});

const content = (dry = DRY_LINE(3, 0), applied = CONTENT_LINE(3, 0)) => [
  { code: 0, output: dry },
  { code: 0, output: applied },
];

describe("parseContentSummary", () => {
  it("reads the totals line", () => {
    expect(parseContentSummary(`x\n${CONTENT_LINE(3, 2, 4, 1)}\n`)).toEqual({
      updated: 3, linksRefreshed: 2, unchanged: 5, notInBronze: 0, failed: 1,
      quizzes: { total: 4, created: 0, changed: 4, unchanged: 0, noQuestionRead: 0 },
    });
    expect(parseContentSummary("nothing here")).toBeNull();
  });

  it("reads the dry run line the capture prints, with its quiz suffix", () => {
    const line = formatContentTotals(false, { updated: 0, urlsRefreshed: 0, unchanged: 53, missing: 0, failed: 0, quizzes: { total: 1, created: 0, updated: 1, unchanged: 0, noQuestionRead: 0 } });
    expect(line).toBe("Dry run, nothing written: 0 updated, 0 links refreshed, 53 unchanged, 0 not in Bronze, 0 failed; 1 quizzes (0 new, 1 changed, 0 unchanged, 0 with no question read)");
    expect(parseContentSummary(line)).toEqual({ updated: 0, linksRefreshed: 0, unchanged: 53, notInBronze: 0, failed: 0, quizzes: { total: 1, created: 0, changed: 1, unchanged: 0, noQuestionRead: 0 } });
  });

  it("still reads a line without the quiz suffix, and ignores unknown trailing text", () => {
    const bare = "Done: 2 updated, 1 links refreshed, 5 unchanged, 0 not in Bronze, 3 failed";
    expect(parseContentSummary(bare)).toEqual({ updated: 2, linksRefreshed: 1, unchanged: 5, notInBronze: 0, failed: 3, quizzes: null });
    const extra = `${CONTENT_LINE(2, 1)}; 9 widgets (a new thing)\nQuizzes reach the Hub with the next run.`;
    expect(parseContentSummary(extra)).toMatchObject({ updated: 2, linksRefreshed: 1, failed: 0, quizzes: { total: 1 } });
  });

  it("the summary line shows the quiz counts", () => {
    const result = { ok: true, stopped: null, failures: [], summary: { content: { applied: true, counts: parseContentSummary(DRY_LINE(0, 0)) } } };
    const text = formatSummary(result).join("\n");
    expect(text).toContain("5 unchanged, 0 not in Bronze, 0 failed; quizzes: 0 new, 1 changed, 0 unchanged.");
    const unread = parseContentSummary(formatContentTotals(true, { ...totals(1, 0), quizzes: { total: 2, created: 1, updated: 0, unchanged: 1, noQuestionRead: 1 } }));
    expect(formatSummary({ ...result, summary: { content: { applied: true, counts: unread } } }).join("\n")).toContain("quizzes: 1 new, 0 changed, 1 unchanged, 1 with no question read.");
  });
});

describe("resolveEnvironment", () => {
  it("picks the target from the env file, prefers the cron secret, lets --base-url win", () => {
    expect(resolveEnvironment({ envFile: ".env.prod", baseUrl: null }, { CRON_SECRET: "c", SUPABASE_SERVICE_ROLE_KEY: "k" }, "https://app.example.com")).toEqual({ baseUrl: "https://app.example.com", secret: "c" });
    expect(resolveEnvironment({ envFile: ".env.local", baseUrl: null }, { SUPABASE_SERVICE_ROLE_KEY: "k" }, "https://app.example.com")).toEqual({ baseUrl: LOCAL_APP_URL, secret: "k" });
    expect(resolveEnvironment({ envFile: ".env.prod", baseUrl: "https://other.example.com" }, { CRON_SECRET: "c" }, "https://app.example.com")).toMatchObject({ baseUrl: "https://other.example.com" });
    expect(resolveEnvironment({ envFile: ".env.local", baseUrl: null }, {}, "x")).toHaveProperty("error");
  });
});

describe("runMigration", () => {
  it("runs the steps in order and sends the secret as a Bearer token", async () => {
    const h = harness({ routes: baseRoutes(), content: content() });
    const result = await runMigration(args(), ENV, h.io);

    expect(buildSteps().map((s) => s.id)).toEqual(["A", "B", "C", "P1", "P2", "K", "K2", "D1", "D2"]);
    expect(h.paths()).toEqual(["/api/import/kajabi-courses", "/api/process/courses", "/api/process/course-files", "/api/process/course-media:plan"]);
    expect(h.calls.every((c) => c.auth === `Bearer ${SECRET}`)).toBe(true);
    expect(h.calls[0].body).toEqual({ courseIds: ["42"] });
    expect(h.calls[2].body).toEqual({ course: "demo-course" });
    expect(result.ok).toBe(true);
    expect(h.logs.join("\n")).not.toContain(SECRET);
    expect(formatSummary(result).join("\n")).not.toContain(SECRET);
  });

  it("stops at the first failing step and runs nothing after it", async () => {
    const h = harness({ routes: baseRoutes({ "/api/import/kajabi-courses": { status: 500, json: { error: "Kajabi said no" } } }) });
    const result = await runMigration(args(), ENV, h.io);
    expect(result.ok).toBe(false);
    expect(result.stopped).toMatchObject({ step: "A", kind: "failed" });
    expect(result.stopped!.message).toMatch(/Kajabi said no/);
    expect(h.paths()).toEqual(["/api/import/kajabi-courses"]);
    expect(h.contentRuns).toEqual([]);
  });

  it("stops after step B when the capture fails", async () => {
    const h = harness({ routes: baseRoutes(), content: [{ code: 1, output: "" }] });
    const result = await runMigration(args(), ENV, h.io);
    expect(result.stopped).toMatchObject({ step: "B", kind: "failed" });
    expect(result.stopped!.message).toMatch(/exit 1/);
    expect(h.contentRuns).toHaveLength(1);
    expect(h.paths()).toEqual(["/api/import/kajabi-courses"]);
  });

  it("stops with a clear message when the server can't be reached or refuses the secret", async () => {
    const down = harness({ routes: baseRoutes({ "/api/import/kajabi-courses": new Error("ECONNREFUSED") }) });
    expect((await runMigration(args(), ENV, down.io)).stopped!.message).toMatch(/pnpm dev/);

    const refused = harness({ routes: baseRoutes({ "/api/import/kajabi-courses": { status: 401, json: { error: "Unauthorized" } } }) });
    const stopped = (await runMigration(args(), ENV, refused.io)).stopped!;
    expect(stopped.message).toMatch(/refused the credentials/);
    expect(stopped.message).not.toContain(SECRET);
  });

  it("fails after step A when lessons could not be placed", async () => {
    const h = harness({ routes: baseRoutes({ "/api/import/kajabi-courses": { courses: [{ ...A_OK.courses[0], unplacedLessons: 4 }] } }) });
    const result = await runMigration(args(), ENV, h.io);
    expect(result.stopped).toMatchObject({ step: "A", kind: "failed" });
    expect(result.stopped!.message).toMatch(/4 lessons could not be placed/);
    expect(h.contentRuns).toEqual([]);
  });

  it("can have a step added to the list (the quiz step will be one)", async () => {
    const order: string[] = [];
    const extra: MigrateStep = { id: "Q", title: "extra", run: async () => void order.push("Q") };
    const h = harness({ routes: baseRoutes(), content: content() });
    const [a, b, ...rest] = buildSteps();
    await runMigration(args(), ENV, h.io, [a, b, extra, ...rest]);
    expect(order).toEqual(["Q"]);
  });

  describe("step B", () => {
    it("does a dry run, asks, then applies", async () => {
      const h = harness({ routes: baseRoutes(), content: content(), confirms: [true] });
      const result = await runMigration(args(["--skip-drafts", "--env", ".env.prod"]), ENV, h.io);
      expect(h.contentRuns).toEqual([
        ["--course", "42", "--env", ".env.prod", "--skip-drafts"],
        ["--course", "42", "--env", ".env.prod", "--skip-drafts", "--apply"],
      ]);
      expect(h.confirmed[0]).toMatch(/Write what the dry run found/);
      expect(result.summary.content).toEqual({ applied: true, counts: expect.objectContaining({ updated: 3, quizzes: expect.objectContaining({ total: 1, changed: 1 }) }) });
    });

    it("writes nothing and stops cleanly when the question is declined", async () => {
      const h = harness({ routes: baseRoutes(), content: content(), confirms: [false] });
      const result = await runMigration(args(), ENV, h.io);
      expect(h.contentRuns).toHaveLength(1);
      expect(result.stopped).toMatchObject({ step: "B", kind: "declined" });
      expect(h.paths()).toEqual(["/api/import/kajabi-courses"]);
    });

    it("--yes skips the question", async () => {
      const h = harness({ routes: baseRoutes(), content: content() });
      await runMigration(args(["--yes"]), ENV, h.io);
      expect(h.confirmed).toEqual([]);
      expect(h.contentRuns).toHaveLength(2);
    });

    it("asks and writes when only a quiz changed (no lesson text or link)", async () => {
      const h = harness({ routes: baseRoutes(), content: [{ code: 0, output: quizLine(0, 1) }, { code: 0, output: CONTENT_LINE(0, 0) }], confirms: [true] });
      const result = await runMigration(args(), ENV, h.io);
      expect(h.confirmed[0]).toMatch(/Write what the dry run found/);
      expect(h.contentRuns).toHaveLength(2);
      expect(h.contentRuns[1]).toContain("--apply");
      expect(result.summary.content?.applied).toBe(true);
    });

    it("asks and writes when only new quizzes are found, and --yes skips the question", async () => {
      const h = harness({ routes: baseRoutes(), content: [{ code: 0, output: quizLine(2, 0) }, { code: 0, output: CONTENT_LINE(0, 0) }] });
      const result = await runMigration(args(["--yes"]), ENV, h.io);
      expect(h.confirmed).toEqual([]);
      expect(h.contentRuns).toHaveLength(2);
      expect(result.summary.content?.applied).toBe(true);
    });

    it("does not write on a dry run that only has unchanged quizzes", async () => {
      const dry = formatContentTotals(false, { updated: 0, urlsRefreshed: 0, unchanged: 53, missing: 0, failed: 0, quizzes: { total: 1, created: 0, updated: 0, unchanged: 1, noQuestionRead: 0 } });
      const h = harness({ routes: baseRoutes(), content: [{ code: 0, output: dry }] });
      await runMigration(args(), ENV, h.io);
      expect(h.contentRuns).toHaveLength(1);
      expect(h.confirmed).toEqual([]);
    });

    it("skips the write when the dry run finds nothing new", async () => {
      const dry = formatContentTotals(false, { updated: 0, urlsRefreshed: 0, unchanged: 5, missing: 0, failed: 0, quizzes: { total: 0, created: 0, updated: 0, unchanged: 0, noQuestionRead: 0 } });
      const h = harness({ routes: baseRoutes(), content: [{ code: 0, output: dry }] });
      const result = await runMigration(args(), ENV, h.io);
      expect(h.contentRuns).toHaveLength(1);
      expect(h.confirmed).toEqual([]);
      expect(result.summary.content?.applied).toBe(false);
      expect(result.ok).toBe(true);
    });
  });

  describe("step C", () => {
    const draft = courseEntry({ isDraft: true, accessDuration: null });

    it("a published course is refreshed without asking, passing along the flags given", async () => {
      const h = harness({ routes: baseRoutes(), content: content() });
      const result = await runMigration(args(["--yes", "--access-duration", "6 months", "--launch-on", "2026-12-01"]), ENV, h.io);
      expect(h.asked).toEqual([]);
      const processCalls = h.calls.filter((c) => c.path === "/api/process/courses");
      expect(processCalls).toHaveLength(1);
      expect(processCalls[0].body).toEqual({ kajabiCourseId: "42", accessDuration: "6 months", launchOn: "2026-12-01" });
      expect(result.summary.course).toEqual({ slug: "demo-course", published: true, justPublished: false });
    });

    it("a new course asks for the access length and launch day, then publishes", async () => {
      const responses = [{ courses: [draft] }, { courses: [courseEntry({ accessDuration: "1 year" })] }];
      const h = harness({
        routes: baseRoutes({ "/api/process/courses": (n: number) => responses[n - 1] }),
        content: content(),
        answers: ["soon", "1 year", "2026-12-01"],
        confirms: [true, true],
      });
      const result = await runMigration(args(), ENV, h.io);
      expect(h.asked).toHaveLength(3);
      const processCalls = h.calls.filter((c) => c.path === "/api/process/courses");
      expect(processCalls[1].body).toEqual({ kajabiCourseId: "42", publish: true, accessDuration: "1 year", launchOn: "2026-12-01" });
      expect(result.summary.course).toMatchObject({ justPublished: true });
      expect(h.paths()).toContain("/api/process/course-files");
    });

    it("flags skip the prompts for a new course (only the publish confirmation remains)", async () => {
      const responses = [{ courses: [draft] }, { courses: [courseEntry()] }];
      const h = harness({
        routes: baseRoutes({ "/api/process/courses": (n: number) => responses[n - 1] }),
        content: content(),
        confirms: [true, true],
      });
      await runMigration(args(["--access-duration", "lifetime", "--launch-on", "2026-12-01"]), ENV, h.io);
      expect(h.asked).toEqual([]);
      const publish = h.calls.filter((c) => c.path === "/api/process/courses")[1];
      expect(publish.body).toEqual({ kajabiCourseId: "42", publish: true, accessDuration: null, launchOn: "2026-12-01" });
    });

    it("--yes without both flags fails for a new course instead of guessing, and publishes nothing", async () => {
      const h = harness({ routes: baseRoutes({ "/api/process/courses": { courses: [draft] } }), content: content() });
      const result = await runMigration(args(["--yes", "--access-duration", "1 year"]), ENV, h.io);
      expect(result.stopped).toMatchObject({ step: "C", kind: "failed" });
      expect(result.stopped!.message).toMatch(/--launch-on/);
      expect(h.calls.filter((c) => c.path === "/api/process/courses")).toHaveLength(1);
      expect(h.paths()).not.toContain("/api/process/course-files");
    });

    it("declining the publish leaves it a draft", async () => {
      const h = harness({
        routes: baseRoutes({ "/api/process/courses": { courses: [draft] } }),
        content: content(),
        answers: ["1 year", ""],
        confirms: [true, false],
      });
      const result = await runMigration(args(), ENV, h.io);
      expect(result.stopped).toMatchObject({ step: "C", kind: "declined" });
      expect(h.calls.filter((c) => c.path === "/api/process/courses")).toHaveLength(1);
      expect(result.summary.course?.published).toBe(false);
    });

    it("gives up after three unreadable answers", async () => {
      const h = harness({ routes: baseRoutes({ "/api/process/courses": { courses: [draft] } }), content: content(), answers: ["?", "??", "???"] });
      const result = await runMigration(args(), ENV, h.io);
      expect(result.stopped).toMatchObject({ step: "C", kind: "failed" });
      expect(h.asked).toHaveLength(3);
    });
  });

  describe("step D, files", () => {
    it("reports failures, carries on, and ends not-ok", async () => {
      const files = { ...FILES_OK, failed: [{ kajabiFileId: "f9", filename: "b.pdf", error: "boom" }] };
      const h = harness({ routes: baseRoutes({ "/api/process/course-files": files }), content: content() });
      const result = await runMigration(args(), ENV, h.io);
      expect(result.stopped).toBeNull();
      expect(result.ok).toBe(false);
      expect(result.failures).toEqual(["1 downloads could not be copied"]);
      expect(h.paths()).toContain("/api/process/course-media:plan");
      expect(result.summary.files).toMatchObject({ copied: 1, alreadyCopied: 2, failed: 1 });
      expect(result.summary.images).toEqual({ stored: 3, failed: 0 });
    });
  });

  describe("step D, videos", () => {
    const planWith = (videos: unknown[]) => ({ "/api/process/course-media:plan": { videos } });

    it("says how many videos and minutes, and uploads nothing when declined", async () => {
      const h = harness({
        routes: baseRoutes(planWith([video("m1", "ready_to_upload"), video("m2", "ready_to_upload", { durationSeconds: 1800 })])),
        content: content(),
        confirms: [true, false],
      });
      const result = await runMigration(args(), ENV, h.io);
      expect(h.logs.join("\n")).toContain("2 videos, 40 minutes");
      expect(h.confirmed.at(-1)).toMatch(/Upload 2 videos \(40 minutes\)/);
      expect(h.paths().filter((p) => p.endsWith(":upload"))).toEqual([]);
      expect(result.stopped).toMatchObject({ step: "D2", kind: "declined" });
      expect(result.summary.videos).toMatchObject({ pending: 2, uploaded: 0, minutes: 40 });
    });

    it("--yes uploads without asking, and leaves drafts' videos alone", async () => {
      const plans = [
        { videos: [video("m1", "ready_to_upload"), video("d1", "ready_to_upload", { draft: true }), video("m3", "uploaded")] },
        { videos: [video("m1", "uploaded"), video("d1", "ready_to_upload", { draft: true }), video("m3", "uploaded", { videoStatus: "preparing" })] },
      ];
      const h = harness({
        routes: baseRoutes({
          "/api/process/course-media:plan": (n: number) => plans[Math.min(n, 2) - 1],
          "/api/process/course-media:upload": { upload: { uploaded: [{ mediaId: "m1" }], failed: [] } },
          "/api/process/course-media:refresh": { refresh: {} },
        }),
        content: content(),
      });
      const result = await runMigration(args(["--yes"]), ENV, h.io);
      expect(h.confirmed).toEqual([]);
      expect(h.calls.filter((c) => c.body.action === "upload")).toHaveLength(1);
      expect(h.calls.some((c) => c.body.action === "upload_drafts")).toBe(false);
      expect(h.paths().at(-1)).toBe("/api/process/course-media:refresh");
      expect(result.summary.videos).toMatchObject({ uploaded: 1, pending: 0, draftsSkipped: 1, alreadyInMux: 1 });
      expect(result.ok).toBe(true);
    });

    it("keeps uploading while videos are left, and stops once none are (including after a timeout)", async () => {
      const left = [3, 2, 1, 0];
      const h = harness({
        routes: baseRoutes({
          "/api/process/course-media:plan": (n: number) => ({ videos: Array.from({ length: left[Math.min(n - 1, 3)] }, (_, i) => video(`m${i}`, "ready_to_upload")) }),
          "/api/process/course-media:upload": (n: number) => (n === 2 ? { status: 504, json: {} } : { upload: { uploaded: [{ mediaId: "x" }], failed: [] } }),
          "/api/process/course-media:refresh": { refresh: {} },
        }),
        content: content(),
      });
      const result = await runMigration(args(["--yes"]), ENV, h.io);
      expect(h.calls.filter((c) => c.body.action === "upload")).toHaveLength(3);
      expect(result.summary.videos).toMatchObject({ uploaded: 2, pending: 0 });
      expect(result.ok).toBe(true);
    });

    it("stops looping when a round makes no progress and reports what failed", async () => {
      const h = harness({
        routes: baseRoutes({
          "/api/process/course-media:plan": { videos: [video("m1", "ready_to_upload")] },
          "/api/process/course-media:upload": { upload: { uploaded: [], failed: [{ mediaId: "m1", error: "Mux said no" }] } },
        }),
        content: content(),
      });
      const result = await runMigration(args(["--yes"]), ENV, h.io);
      expect(h.calls.filter((c) => c.body.action === "upload")).toHaveLength(1);
      expect(result.ok).toBe(false);
      expect(result.failures).toEqual(["video m1: Mux said no"]);
      expect(result.summary.videos).toMatchObject({ pending: 1, failed: 1 });
    });

    it("does nothing, asks nothing and is ok when every video is already in Mux (a launch-day no-op)", async () => {
      const h = harness({ routes: baseRoutes({ "/api/process/course-media:plan": { videos: [video("m1", "uploaded")] } }), content: [{ code: 0, output: NOTHING_NEW }] });
      const result = await runMigration(args(), ENV, h.io);
      expect(h.confirmed).toEqual([]);
      expect(h.paths().some((p) => p.endsWith(":upload"))).toBe(false);
      expect(result.ok).toBe(true);
    });

    it("counts a video with an expired link as pending, not uploadable", async () => {
      const h = harness({ routes: baseRoutes({ "/api/process/course-media:plan": { videos: [video("m1", "link_expired")] } }), content: content() });
      const result = await runMigration(args(), ENV, h.io);
      expect(result.summary.videos).toMatchObject({ pending: 1, needsNewLink: 1 });
      expect(h.confirmed.some((q) => /Upload/.test(q))).toBe(false);
    });
  });

  it("prints a summary of what happened", async () => {
    const h = harness({ routes: baseRoutes({ "/api/process/course-media:plan": { videos: [video("m1", "uploaded")] } }), content: content() });
    const result = await runMigration(args(["--yes"]), ENV, h.io);
    const text = formatSummary(result).join("\n");
    expect(text).toContain("Lesson content: 3 captured");
    expect(text).toContain("quizzes: 0 new, 1 changed, 0 unchanged");
    expect(text).toContain("Downloads: 1 copied, 2 already there");
    expect(text).toContain("Images: 3 stored");
    expect(text).toContain("Videos: 0 uploaded now, 1 already in Mux, 0 pending");
    expect(text).toContain("All steps finished.");
  });

  it("the summary of a stopped run says where", async () => {
    const h = harness({ routes: baseRoutes({ "/api/import/kajabi-courses": { status: 500, json: { error: "nope" } } }) });
    const text = formatSummary(await runMigration(args(), ENV, h.io)).join("\n");
    expect(text).toContain("STOPPED at step A");
  });
});

const PROGRESS_LINES = (roster: number, lessons: number, failed = 0, verb = "Dry run, nothing written") =>
  `\n${verb}: 4 students in the roster (${roster} written, 1 unchanged, 0 removed; 0 unusable, 0 duplicate emails)\n` +
  `lessons: 4 students captured, 20 lessons listed, 9 completed; ${lessons} rows written, 2 unchanged, 0 removed; 0 students with no lessons, ${failed} failed, 0 lessons not in Bronze`;
const COMMENT_LINES = (written: number, failed = 0, verb = "Dry run, nothing written") =>
  `\n${verb}: 5 lessons captured, 3 with comments; 7 comments and replies (2 replies); ${written} rows written, 1 unchanged, 0 removed\n` +
  "comment ids: 7 from the page (5 reply link, 1 reply container, 1 data-comment), 0 hashed, 0 repeated within a lesson\n" +
  `lessons: 0 cut off at the Show More limit, 0 with a different total on the page, 2 with no comments (the page has a comment box), 0 quizzes (no comments by design), 0 locked until an earlier lesson is completed (their comments cannot be read from this preview), 0 with none of those (look at these), ${failed} failed, 0 not in Bronze (skipped)`;
const ok = (output: string) => ({ code: 0, output });
const PROGRESS_ROUTE = (inserted: number) => ({
  success: true,
  courses: [{ slug: "demo-course", inserted, alreadyCompleted: 4, leftAlone: 1, students: { matched: 3, unmatched: 1, ambiguous: 0, withoutAccess: 0 } }],
});

describe("optional progress and comments steps", () => {
  const bDone = [ok(NOTHING_NEW)]; // step B finds nothing new, so it runs once

  it("go after step C and before the downloads, in this order", () => {
    const ids = buildSteps().map((s) => s.id);
    expect(ids.indexOf("C")).toBeLessThan(ids.indexOf("P1"));
    expect(ids.indexOf("P1")).toBeLessThan(ids.indexOf("P2"));
    expect(ids.indexOf("P2")).toBeLessThan(ids.indexOf("K"));
    expect(ids.indexOf("K")).toBeLessThan(ids.indexOf("K2"));
    expect(ids.indexOf("K2")).toBeLessThan(ids.indexOf("D1"));
  });

  it("the progress capture does a dry run, asks, then applies; processing does a dry run, then the real call", async () => {
    const routes = baseRoutes({
      "/api/process/course-progress": PROGRESS_ROUTE(6),
    });
    const h = harness({
      routes,
      content: [...bDone, ok(PROGRESS_LINES(4, 12)), ok(PROGRESS_LINES(4, 12, 0, "Done")), ok(COMMENT_LINES(0))],
      confirms: [true],
    });
    const result = await runMigration(withOptional(["--env", ".env.prod"]), ENV, h.io);

    expect(h.contentRuns.slice(1, 3)).toEqual([
      ["--course", "42", "--env", ".env.prod", "--progress"],
      ["--course", "42", "--env", ".env.prod", "--progress", "--apply"],
    ]);
    expect(h.confirmed).toHaveLength(2);
    expect(h.confirmed[0]).toMatch(/progress/);
    expect(h.confirmed[1]).toBe("Add 6 completed lessons to the Hub's progress? Insert-only: a member's own progress is never overwritten.");
    const progressCalls = h.calls.filter((c) => c.path === "/api/process/course-progress");
    expect(progressCalls.map((c) => c.body)).toEqual([
      { course: "demo-course", dryRun: true },
      { course: "demo-course", dryRun: false },
    ]);
    // The capture is ordered before the processing, and both come after step C.
    const order = h.paths();
    expect(order.indexOf("/api/process/courses")).toBeLessThan(order.indexOf("/api/process/course-progress"));
    expect(result.summary.progress).toMatchObject({ outcome: "applied", counts: { roster: { written: 4 }, lessons: { written: 12 } } });
    expect(result.summary.progressImport).toMatchObject({ inserted: 6, applied: true });
    const text = formatSummary(result).join("\n");
    expect(text).toContain("Progress in the Hub: 6 completed lessons added");
    expect(text).toContain("Insert-only");
    expect(result.ok).toBe(true);
  });

  it("--yes skips the questions for both captures", async () => {
    const h = harness({
      routes: baseRoutes(),
      content: [...bDone, ok(PROGRESS_LINES(1, 1)), ok(PROGRESS_LINES(1, 1, 0, "Done")), ok(COMMENT_LINES(3)), ok(COMMENT_LINES(3, 0, "Done"))],
    });
    const result = await runMigration(withOptional(["--yes"]), ENV, h.io);
    expect(h.confirmed).toEqual([]);
    expect(h.contentRuns.filter((r) => r.includes("--apply"))).toHaveLength(2);
    expect(result.summary.comments).toMatchObject({ outcome: "applied" });
  });

  it("nothing new skips the write for each capture, and still processes what Bronze holds", async () => {
    const h = harness({ routes: baseRoutes(), content: [...bDone, ok(PROGRESS_LINES(0, 0)), ok(COMMENT_LINES(0))] });
    const result = await runMigration(withOptional(), ENV, h.io);
    expect(h.contentRuns.filter((r) => r.includes("--apply"))).toHaveLength(0);
    expect(h.confirmed).toEqual([]);
    expect(result.summary.progress?.outcome).toBe("nothing_new");
    expect(result.summary.comments?.outcome).toBe("nothing_new");
    // Processing ran (a dry run), found nothing to add, and made no real call.
    expect(h.calls.filter((c) => c.path === "/api/process/course-progress").map((c) => c.body.dryRun)).toEqual([true]);
    expect(result.ok).toBe(true);
  });

  it("P2 asks before writing, --yes skips the question, and a no skips only P2 with exit 0", async () => {
    const routes = baseRoutes({ "/api/process/course-progress": PROGRESS_ROUTE(6) });
    const bronze = [...bDone, ok(PROGRESS_LINES(0, 0)), ok(COMMENT_LINES(0))];

    const yes = harness({ routes, content: bronze });
    await runMigration(withOptional(["--yes"]), ENV, yes.io);
    expect(yes.confirmed).toEqual([]);
    expect(yes.calls.filter((c) => c.path === "/api/process/course-progress").map((c) => c.body.dryRun)).toEqual([true, false]);

    const no = harness({ routes, content: bronze, confirms: [false] });
    const result = await runMigration(withOptional(), ENV, no.io);
    expect(no.confirmed).toHaveLength(1);
    expect(no.calls.filter((c) => c.path === "/api/process/course-progress").map((c) => c.body.dryRun)).toEqual([true]);
    expect(result.summary.progressImport).toMatchObject({ inserted: 0, applied: false, declined: true });
    expect(formatSummary(result).join("\n")).toContain("(declined; 6 would be added)");
    expect(no.paths()).toContain("/api/process/course-files");
    expect(result.stopped).toBeNull();
    expect(result.ok).toBe(true);
  });

  it("P2 does not ask when the dry run would add nothing", async () => {
    const h = harness({ routes: baseRoutes({ "/api/process/course-progress": PROGRESS_ROUTE(0) }), content: [...bDone, ok(PROGRESS_LINES(0, 0)), ok(COMMENT_LINES(0))] });
    await runMigration(withOptional(), ENV, h.io);
    expect(h.confirmed).toEqual([]);
    expect(h.calls.filter((c) => c.path === "/api/process/course-progress").map((c) => c.body.dryRun)).toEqual([true]);
  });

  it("declining a capture skips only that capture and the run carries on without failing", async () => {
    const h = harness({
      routes: baseRoutes(),
      content: [...bDone, ok(PROGRESS_LINES(2, 2)), ok(COMMENT_LINES(0))],
      confirms: [false],
    });
    const result = await runMigration(withOptional(), ENV, h.io);
    expect(result.summary.progress?.outcome).toBe("declined");
    expect(h.contentRuns.filter((r) => r.includes("--apply"))).toHaveLength(0);
    expect(h.paths()).toContain("/api/process/course-files");
    expect(result.stopped).toBeNull();
    expect(result.ok).toBe(true);
  });

  it("--skip-progress and --skip-comments leave the steps out and say so", async () => {
    const h = harness({ routes: baseRoutes(), content: bDone });
    const result = await runMigration(withOptional(["--skip-progress", "--skip-comments"]), ENV, h.io);
    expect(h.contentRuns).toHaveLength(1);
    expect(h.paths().some((p) => p.includes("course-progress"))).toBe(false);
    const text = formatSummary(result).join("\n");
    expect(text).toContain("Progress: skipped (--skip-progress)");
    expect(text).toContain("Comments: skipped (--skip-comments)");
  });

  it("--skip-comments alone still captures and processes progress", async () => {
    const h = harness({ routes: baseRoutes(), content: [...bDone, ok(PROGRESS_LINES(0, 0))] });
    await runMigration(withOptional(["--skip-comments"]), ENV, h.io);
    expect(h.contentRuns.map((r) => r.includes("--progress"))).toEqual([false, true]);
    expect(h.contentRuns.some((r) => r.includes("--comments"))).toBe(false);
  });

  it("a failed progress capture is reported, skips processing, carries on to the media step and fails the run", async () => {
    const h = harness({
      routes: baseRoutes(),
      content: [...bDone, { code: 1, output: PROGRESS_LINES(0, 0, 2) }, ok(COMMENT_LINES(0))],
    });
    const result = await runMigration(withOptional(), ENV, h.io);
    expect(result.summary.progress?.outcome).toBe("failed");
    expect(h.paths().some((p) => p.includes("course-progress"))).toBe(false);
    expect(h.paths()).toContain("/api/process/course-media:plan");
    expect(result.stopped).toBeNull();
    expect(result.ok).toBe(false);
    expect(result.failures.join("\n")).toMatch(/progress capture failed \(exit 1\)/);
    expect(formatSummary(result).join("\n")).toContain("Finished, but some items failed");
  });

  it("a failed comments capture does not block videos and files, but fails the run", async () => {
    const h = harness({ routes: baseRoutes(), content: [...bDone, { code: 1, output: "" }], });
    const result = await runMigration(withOptional(["--skip-progress"]), ENV, h.io);
    expect(result.summary.comments?.outcome).toBe("failed");
    expect(h.paths()).toEqual(expect.arrayContaining(["/api/process/course-files", "/api/process/course-media:plan"]));
    expect(result.stopped).toBeNull();
    expect(result.ok).toBe(false);
    expect(result.failures.join("\n")).toMatch(/not verified against the live Kajabi site/);
    expect(formatSummary(result).join("\n")).toContain("capture failed");
  });

  it("a capture that cannot start is a failure, not a crash", async () => {
    const h = harness({ routes: baseRoutes(), content: bDone });
    let runs = 0;
    const original = h.io.runContent;
    h.io.runContent = async (a) => {
      if (++runs === 2) throw new Error("spawn failed");
      return original(a);
    };
    const result = await runMigration(withOptional(["--skip-comments"]), ENV, h.io);
    expect(result.failures.join("\n")).toMatch(/could not start \(spawn failed\)/);
    expect(h.paths()).toContain("/api/process/course-media:plan");
  });

  it("a failed progress processing call is reported and the run carries on, exit-failing", async () => {
    const h = harness({
      routes: baseRoutes({ "/api/process/course-progress": { status: 500, json: { error: "boom" } } }),
      content: [...bDone, ok(PROGRESS_LINES(0, 0))],
    });
    const result = await runMigration(withOptional(["--skip-comments"]), ENV, h.io);
    expect(result.failures.join("\n")).toMatch(/progress import into the Hub failed: .*boom/);
    expect(h.paths()).toContain("/api/process/course-media:plan");
    expect(result.ok).toBe(false);
  });

  it("the comments import does a dry run, asks, then writes; nothing is sent to members", async () => {
    const h = harness({
      routes: baseRoutes({ "/api/process/course-comments": COMMENTS_ROUTE(5, { updated: 1 }) }),
      content: [...bDone, ok(COMMENT_LINES(0))],
      confirms: [true],
    });
    const result = await runMigration(withOptional(["--skip-progress"]), ENV, h.io);
    expect(h.confirmed).toHaveLength(1);
    expect(h.confirmed[0]).toMatch(/lesson threads/);
    // The names the match could not settle are listed for the owner, with how many comments they hold.
    expect(h.logs.join("\n")).toContain("No member has this name, so 2 comments are left out:");
    expect(h.logs.join("\n")).toContain("  Nobody Known (2 comments)");
    expect(h.logs.join("\n")).toContain("  Cy Twin (1 comments, 2 members)");
    expect(h.calls.filter((c) => c.path === "/api/process/course-comments").map((c) => c.body)).toEqual([
      { course: "demo-course", dryRun: true },
      { course: "demo-course", dryRun: false },
    ]);
    expect(result.summary.commentsImport).toMatchObject({ written: 6, applied: true, dryRun: { inserted: 5, updated: 1, unchanged: 2, unmatchedLessonComments: 1 } });
    const text = formatSummary(result).join("\n");
    expect(text).toContain("Comments in the Hub: 6 written");
    expect(text).toContain("3 left out because their author's name matched no member or several");
    expect(text).toContain("nobody is notified");
    expect(result.ok).toBe(true);
  });

  it("the comments import with --yes asks nothing, and declining it writes nothing", async () => {
    const yes = harness({ routes: baseRoutes({ "/api/process/course-comments": COMMENTS_ROUTE(2) }), content: [...bDone, ok(COMMENT_LINES(0))] });
    await runMigration(withOptional(["--skip-progress", "--yes"]), ENV, yes.io);
    expect(yes.confirmed).toEqual([]);
    expect(yes.calls.filter((c) => c.path === "/api/process/course-comments").map((c) => c.body.dryRun)).toEqual([true, false]);

    const no = harness({ routes: baseRoutes({ "/api/process/course-comments": COMMENTS_ROUTE(2) }), content: [...bDone, ok(COMMENT_LINES(0))], confirms: [false] });
    const result = await runMigration(withOptional(["--skip-progress"]), ENV, no.io);
    expect(no.calls.filter((c) => c.path === "/api/process/course-comments").map((c) => c.body.dryRun)).toEqual([true]);
    expect(result.summary.commentsImport).toMatchObject({ written: 0, applied: false });
    expect(result.ok).toBe(true);
  });

  it("nothing to add makes no real call, --skip-comments leaves the import out, and a failed capture skips it", async () => {
    const none = harness({ routes: baseRoutes(), content: [...bDone, ok(COMMENT_LINES(0))] });
    const noneResult = await runMigration(withOptional(["--skip-progress"]), ENV, none.io);
    expect(none.calls.filter((c) => c.path === "/api/process/course-comments").map((c) => c.body.dryRun)).toEqual([true]);
    expect(noneResult.summary.commentsImport).toMatchObject({ written: 0, applied: false });

    const skipped = harness({ routes: baseRoutes(), content: bDone });
    await runMigration(withOptional(["--skip-progress", "--skip-comments"]), ENV, skipped.io);
    expect(skipped.paths()).not.toContain("/api/process/course-comments");

    const failed = harness({ routes: baseRoutes(), content: [...bDone, { code: 1, output: "" }] });
    await runMigration(withOptional(["--skip-progress"]), ENV, failed.io);
    expect(failed.paths()).not.toContain("/api/process/course-comments");
  });

  it("a failed comments import is reported and the run carries on, exit-failing", async () => {
    const h = harness({
      routes: baseRoutes({ "/api/process/course-comments": { status: 500, json: { error: "boom" } } }),
      content: [...bDone, ok(COMMENT_LINES(0))],
    });
    const result = await runMigration(withOptional(["--skip-progress"]), ENV, h.io);
    expect(result.failures.join("\n")).toMatch(/comments import into the Hub failed: .*boom/);
    expect(h.paths()).toContain("/api/process/course-media:plan");
    expect(result.ok).toBe(false);
  });

  it("the summary says comments are in Bronze only and prints counts, never rows", async () => {
    const h = harness({
      routes: baseRoutes({ "/api/process/course-progress": PROGRESS_ROUTE(0) }),
      content: [...bDone, ok(PROGRESS_LINES(0, 0)), ok(COMMENT_LINES(4)), ok(COMMENT_LINES(4, 0, "Done"))],
    });
    const result = await runMigration(withOptional(["--yes"]), ENV, h.io);
    const text = formatSummary(result).join("\n");
    expect(text).toContain("Comments: captured to Bronze.");
    expect(text).toContain("(4 written, 1 unchanged, 0 removed.)");
    expect(text).toContain("Progress: nothing new in Bronze");
  });
});

describe("parseProgressSummary and parseCommentsSummary against the real printers", () => {
  const rows = { written: 3, unchanged: 2, removed: 1 };
  it("read what formatProgressTotals and formatCommentsTotals build", () => {
    const progress = formatProgressTotals(false, { members: 4, rosterSkipped: 0, duplicateEmails: 0, rosterCountMismatch: false, roster: rows, membersCaptured: 4, membersFailed: 2, membersWithoutLessons: 0, lessonsListed: 9, lessonsCompleted: 5, lessonsNotInBronze: 0, lessons: { written: 7, unchanged: 1, removed: 0 } });
    expect(parseProgressSummary(progress)).toEqual({ roster: rows, lessons: { written: 7, unchanged: 1, removed: 0 }, failed: 2 });
    const comments = formatCommentsTotals(true, {
      lessonsListed: 5, lessonsNotInBronze: 0, lessonsCaptured: 5, lessonsWithComments: 3, comments: 7, replies: 2, rows, keySources: { "reply-link": 1, "reply-container": 1, "data-comment": 1, hash: 0 },
      duplicateKeys: 0, lessonsNoComments: 0, lessonsQuizzes: 0, lessonsLocked: 0, lessonsWithoutList: 0, lessonsCapped: 1, lessonsMismatched: 0, lessonsFailed: 2,
    });
    expect(parseCommentsSummary(comments)).toEqual({ rows, lessonsFailed: 2, lessonsCapped: 1 });
  });
});

describe("parseProgressSummary and parseCommentsSummary", () => {
  it("read the totals lines the capture prints", () => {
    expect(parseProgressSummary(PROGRESS_LINES(4, 12, 1))).toEqual({
      roster: { written: 4, unchanged: 1, removed: 0 },
      lessons: { written: 12, unchanged: 2, removed: 0 },
      failed: 1,
    });
    expect(parseCommentsSummary(COMMENT_LINES(3, 2))).toEqual({ rows: { written: 3, unchanged: 1, removed: 0 }, lessonsFailed: 2, lessonsCapped: 0 });
  });

  it("return null for output they cannot read", () => {
    expect(parseProgressSummary("nothing")).toBeNull();
    expect(parseCommentsSummary("nothing")).toBeNull();
  });
});
