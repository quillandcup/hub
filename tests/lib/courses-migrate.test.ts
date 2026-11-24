import { describe, it, expect } from "vitest";
import { buildSteps, formatSummary, parseContentSummary, resolveEnvironment, runMigration, LOCAL_APP_URL, type MigrateIO, type MigrateStep } from "@/lib/courses/migrate";
import { parseMigrateArgs, type MigrateArgs } from "@/lib/courses/migrate-args";

const SECRET = "s3cret-token";
const ENV = { baseUrl: "https://hub.example.com", secret: SECRET };

function args(extra: string[] = []): MigrateArgs {
  const parsed = parseMigrateArgs(["--course", "42", ...extra]);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed;
}

const CONTENT_LINE = (u: number, l: number, q = 1, f = 0) => `Done: ${u} updated, ${l} links refreshed, 5 unchanged, 0 not in Bronze, ${q} quizzes skipped, ${f} failed`;
const DRY_LINE = (u: number, l: number) => `Dry run, nothing written: ${u} updated, ${l} links refreshed, 5 unchanged, 0 not in Bronze, 1 quizzes skipped, 0 failed`;

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

const baseRoutes = (over: Record<string, any> = {}) => ({
  "/api/import/kajabi-courses": A_OK,
  "/api/process/courses": { courses: [courseEntry()] },
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
    expect(parseContentSummary(`x\n${CONTENT_LINE(3, 2, 4, 1)}\n`)).toEqual({ updated: 3, linksRefreshed: 2, unchanged: 5, notInBronze: 0, quizzesSkipped: 4, failed: 1 });
    expect(parseContentSummary("nothing here")).toBeNull();
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

    expect(buildSteps().map((s) => s.id)).toEqual(["A", "B", "C", "D1", "D2"]);
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
      expect(result.summary.content).toEqual({ applied: true, counts: expect.objectContaining({ updated: 3, quizzesSkipped: 1 }) });
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

    it("skips the write when the dry run finds nothing new", async () => {
      const h = harness({ routes: baseRoutes(), content: [{ code: 0, output: DRY_LINE(0, 0) }] });
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
      const h = harness({ routes: baseRoutes({ "/api/process/course-media:plan": { videos: [video("m1", "uploaded")] } }), content: [{ code: 0, output: DRY_LINE(0, 0) }] });
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
    expect(text).toContain("1 quizzes skipped");
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
