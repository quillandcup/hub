import { isValidDay, parseAccessDuration, type MigrateArgs } from "@/lib/courses/migrate-args";

/**
 * The one-command Kajabi course migration (`pnpm courses:migrate`, docs/product/COURSES.md "Migration pipeline"):
 * steps A (structure), B (content), C (process), the optional progress and comments captures, and D (files, images, videos) run in order, stopping at the
 * first one that fails with what to do next. Every step is safe to repeat, so a re-run only does new work and
 * a run with nothing new is a no-op that prints the same summary.
 *
 * Everything outside is injected (`MigrateIO`: fetch, prompts, the Kajabi capture child process, output), so
 * the order, the stops, the questions and the upload loop are tested without a server, a browser or a terminal.
 * A step is an entry in `buildSteps`; a new one (the planned quiz step) is one more object in that list.
 */

export interface MigrateIO {
  fetch: typeof fetch;
  /** y/N question; true for yes. */
  confirm(question: string): Promise<boolean>;
  /** Free-text question; the answer, trimmed. */
  ask(question: string): Promise<string>;
  /** Runs `scripts/kajabi-course-content.ts` with these arguments, output going to the terminal as well as coming back. */
  runContent(args: string[]): Promise<{ code: number; output: string }>;
  log(line: string): void;
}

export interface MigrateEnvironment {
  baseUrl: string;
  /** Sent as a Bearer token; never printed. */
  secret: string;
}

/** Written / unchanged / removed rows, as the capture scripts print them. */
export interface RowCounts {
  written: number;
  unchanged: number;
  removed: number;
}

/** Counts from the progress capture's two last lines. */
export interface ProgressCaptureCounts {
  roster: RowCounts;
  lessons: RowCounts;
  failed: number;
}

/** Counts from the comments capture's last lines. */
export interface CommentsCaptureCounts {
  rows: RowCounts;
  lessonsFailed: number;
  lessonsCapped: number;
}

/** What the comments import counts (dry run or real). */
export interface CommentsImportCounts {
  inserted: number;
  updated: number;
  unchanged: number;
  unmatchedLessonComments: number;
  /** Comments left out because their author's name matches no member, or more than one (the names are listed in the dry run). */
  unmatchedAuthorComments: number;
  ambiguousAuthorComments: number;
}

/** What an optional capture did: wrote, found nothing new, was declined, or failed (the run carries on, exit code 1). */
export type OptionalOutcome = "applied" | "nothing_new" | "declined" | "failed";

/** Counts from the content step's own last line. */
export interface ContentCounts {
  updated: number;
  linksRefreshed: number;
  unchanged: number;
  notInBronze: number;
  quizzesSkipped: number;
  failed: number;
}

export interface MigrateSummary {
  structure?: { title: string; modules: number; lessons: number; unplacedLessons: number };
  /** Null counts: the step ran but its summary line couldn't be read. */
  content?: { applied: boolean; counts: ContentCounts | null };
  course?: { slug: string; published: boolean; justPublished: boolean };
  progress?: { outcome: OptionalOutcome; counts: ProgressCaptureCounts | null };
  /** The insert-only import of Bronze progress into the Hub's own progress (counts of members' completed lessons). */
  progressImport?: { dryRun: { inserted: number; alreadyCompleted: number; leftAlone: number }; inserted: number; applied: boolean };
  comments?: { outcome: OptionalOutcome; counts: CommentsCaptureCounts | null };
  /** The import of Bronze comments into the Hub's lesson comments (counts of comments). */
  commentsImport?: { dryRun: CommentsImportCounts; written: number; applied: boolean };
  /** Optional captures left out with --skip-progress / --skip-comments. */
  skippedOptional?: ("progress" | "comments")[];
  files?: { copied: number; alreadyCopied: number; removed: number; needsNewLink: number; waitingForLesson: number; failed: number };
  images?: { stored: number; failed: number } | null;
  videos?: {
    total: number;
    alreadyInMux: number;
    uploaded: number;
    /** Visible lessons' videos still not in Mux (declined, no usable link, or failed). */
    pending: number;
    needsNewLink: number;
    failed: number;
    /** Videos only draft lessons use: never uploaded by this command. */
    draftsSkipped: number;
    minutes: number;
  };
}

export type StopKind = "failed" | "declined";

export interface MigrateResult {
  /** Nothing failed and nothing was declined. */
  ok: boolean;
  stopped: { step: string; kind: StopKind; message: string } | null;
  /** Items that failed inside a step that carried on (a file that wouldn't copy, a video Mux refused). */
  failures: string[];
  summary: MigrateSummary;
}

/** Thrown by a step to stop the run; `message` says what to do next. */
export class MigrateStop extends Error {
  constructor(message: string, readonly kind: StopKind = "failed") {
    super(message);
  }
}

class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

interface Context {
  args: MigrateArgs;
  env: MigrateEnvironment;
  io: MigrateIO;
  summary: MigrateSummary;
  failures: string[];
  /** Filled in by step C. */
  slug: string | null;
}

export interface MigrateStep {
  id: string;
  title: string;
  run(ctx: Context): Promise<void>;
}

const MAX_UPLOAD_ROUNDS = 20;

async function call(ctx: Context, path: string, body: unknown): Promise<any> {
  let response: Response;
  try {
    response = await ctx.io.fetch(`${ctx.env.baseUrl}${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${ctx.env.secret}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new MigrateStop(`Couldn't reach ${ctx.env.baseUrl} (${reason}). For a local run start the app with "pnpm dev" first; otherwise check --base-url.`);
  }
  const parsed = await response.json().catch(() => null);
  if (response.ok) return parsed ?? {};
  const detail = typeof parsed?.error === "string" ? parsed.error : `the server answered ${response.status}`;
  if (response.status === 401 || response.status === 403) {
    throw new MigrateStop(`${ctx.env.baseUrl} refused the credentials (${response.status}). The secret in your env file has to be the one that server uses (CRON_SECRET or SUPABASE_SERVICE_ROLE_KEY).`);
  }
  throw new ApiError(detail, response.status);
}

/** Runs `call`, turning a route's own error into a stop that names the step and what to do. */
async function callStep(ctx: Context, step: string, path: string, body: unknown, hint: string): Promise<any> {
  try {
    return await call(ctx, path, body);
  } catch (error) {
    if (error instanceof ApiError) throw new MigrateStop(`${step} failed: ${error.message}. ${hint}`);
    throw error;
  }
}

/** Reads the totals line the content script prints ("Done: 3 updated, 0 links refreshed, ..."). */
export function parseContentSummary(output: string): ContentCounts | null {
  const line = output.split("\n").find((l) => /quizzes skipped/.test(l) && /updated/.test(l));
  if (!line) return null;
  const n = (label: string) => Number(new RegExp(`(\\d+) ${label}`).exec(line)?.[1] ?? 0);
  return {
    updated: n("updated"),
    linksRefreshed: n("links refreshed"),
    unchanged: n("unchanged"),
    notInBronze: n("not in Bronze"),
    quizzesSkipped: n("quizzes skipped"),
    failed: n("failed"),
  };
}

const stepA: MigrateStep = {
  id: "A",
  title: "Structure from the Kajabi API",
  async run(ctx) {
    const result = await callStep(ctx, "Step A", "/api/import/kajabi-courses", { courseIds: [ctx.args.courseId] }, "Check the Kajabi credentials on that server and the course id, then re-run.");
    const course = (result.courses ?? []).find((c: any) => String(c.id) === ctx.args.courseId);
    if (!course) throw new MigrateStop(`Step A returned no course ${ctx.args.courseId}. Check the course id against the Kajabi admin URL, then re-run.`);
    ctx.summary.structure = { title: course.title, modules: course.modules, lessons: course.lessons, unplacedLessons: course.unplacedLessons ?? 0 };
    ctx.io.log(`"${course.title}": ${course.modules} modules, ${course.lessons} lessons, ${course.offers ?? 0} offers.`);
    if (course.unplacedLessons > 0) {
      throw new MigrateStop(
        `${course.unplacedLessons} lessons could not be placed in a module, so the live Kajabi response differs from what the importer assumes. ` +
          `Nothing past step A ran. Look at docs/product/COURSES.md ("Built (steps A and C)") and fix the importer before going on.`
      );
    }
  },
};

const stepB: MigrateStep = {
  id: "B",
  title: "Lesson content from Kajabi (opens Chrome)",
  async run(ctx) {
    const base = ["--course", ctx.args.courseId, "--env", ctx.args.envFile, ...(ctx.args.skipDrafts ? ["--skip-drafts"] : [])];
    const failedMessage = (code: number) =>
      `Step B failed (exit ${code}). Read the lines above (a lesson that timed out, or a Kajabi login that expired), fix that, and re-run: it only redoes what is missing.`;

    ctx.io.log("Capturing lessons as a dry run first (nothing is written)...");
    const dry = await ctx.io.runContent(base);
    if (dry.code !== 0) throw new MigrateStop(failedMessage(dry.code));
    const dryCounts = parseContentSummary(dry.output);
    if (dryCounts && dryCounts.updated + dryCounts.linksRefreshed === 0) {
      ctx.io.log("Nothing new in Kajabi: no lesson text or video link to write.");
      ctx.summary.content = { applied: false, counts: dryCounts };
      return;
    }
    if (!ctx.args.yes && !(await ctx.io.confirm("Write what the dry run found to the database?"))) {
      ctx.summary.content = { applied: false, counts: dryCounts };
      throw new MigrateStop("Stopped before writing the lesson content. Nothing changed. Run the command again when you are ready.", "declined");
    }

    const applied = await ctx.io.runContent([...base, "--apply"]);
    if (applied.code !== 0) throw new MigrateStop(failedMessage(applied.code));
    ctx.summary.content = { applied: true, counts: parseContentSummary(applied.output) };
  },
};

const rowCounts = (line: string | undefined): RowCounts | null => {
  const m = line ? /(\d+) (?:rows )?written, (\d+) unchanged, (\d+) removed/.exec(line) : null;
  return m ? { written: Number(m[1]), unchanged: Number(m[2]), removed: Number(m[3]) } : null;
};

/** Reads the totals the progress capture prints (the roster line and the "lessons:" line). */
export function parseProgressSummary(output: string): ProgressCaptureCounts | null {
  const lines = output.split("\n");
  const roster = rowCounts(lines.find((l) => /students in the roster/.test(l)));
  const lessonsLine = lines.find((l) => /^lessons: .*students captured/.test(l));
  const lessons = rowCounts(lessonsLine);
  if (!roster || !lessons || !lessonsLine) return null;
  return { roster, lessons, failed: Number(/(\d+) failed/.exec(lessonsLine)?.[1] ?? 0) };
}

/** Reads the totals the comments capture prints (its first summary line and the "lessons:" line). */
export function parseCommentsSummary(output: string): CommentsCaptureCounts | null {
  const lines = output.split("\n");
  const rows = rowCounts(lines.find((l) => /lessons captured/.test(l) && /rows written/.test(l)));
  const lessonsLine = lines.find((l) => /^lessons: .*cut off at the Show More limit/.test(l));
  if (!rows || !lessonsLine) return null;
  return {
    rows,
    lessonsFailed: Number(/(\d+) failed/.exec(lessonsLine)?.[1] ?? 0),
    lessonsCapped: Number(/(\d+) cut off/.exec(lessonsLine)?.[1] ?? 0),
  };
}

const hasNewRows = (...counts: RowCounts[]) => counts.some((c) => c.written + c.removed > 0);

/**
 * A Kajabi capture that is not worth stopping the run for: dry run first, then (if anything is new) a question
 * unless --yes, then --apply. A failure is recorded and the run carries on; a "no" skips only this capture.
 */
async function optionalCapture<C>(
  ctx: Context,
  options: { label: string; flag: string; parse: (output: string) => C | null; isNew: (counts: C) => boolean; question: string; hint: string }
): Promise<{ outcome: OptionalOutcome; counts: C | null }> {
  const base = ["--course", ctx.args.courseId, "--env", ctx.args.envFile, options.flag];
  const failed = (message: string, counts: C | null) => {
    ctx.failures.push(`${options.label} capture ${message}. ${options.hint}`);
    ctx.io.log(`The ${options.label} capture failed; carrying on with the next step.`);
    return { outcome: "failed" as const, counts };
  };
  const run = async (args: string[]) => {
    try {
      return await ctx.io.runContent(args);
    } catch (error) {
      return { code: -1, output: "", error: error instanceof Error ? error.message : String(error) };
    }
  };
  const why = (r: { code: number; error?: string }) => (r.error ? `could not start (${r.error})` : `failed (exit ${r.code})`);

  ctx.io.log(`Capturing ${options.label} as a dry run first (nothing is written)...`);
  const dry = await run(base);
  const dryCounts = options.parse(dry.output);
  if (dry.code !== 0) return failed(why(dry), dryCounts);
  if (dryCounts && !options.isNew(dryCounts)) {
    ctx.io.log(`Nothing new in Kajabi: no ${options.label} to write.`);
    return { outcome: "nothing_new", counts: dryCounts };
  }
  if (!ctx.args.yes && !(await ctx.io.confirm(options.question))) {
    ctx.io.log(`Skipped writing ${options.label}. Nothing changed; run the command again to capture them.`);
    return { outcome: "declined", counts: dryCounts };
  }
  const applied = await run([...base, "--apply"]);
  const counts = options.parse(applied.output);
  if (applied.code !== 0) return failed(why(applied), counts);
  return { outcome: "applied", counts };
}

const stepProgressCapture: MigrateStep = {
  id: "P1",
  title: "Per-lesson progress from Kajabi (opens Chrome, optional)",
  async run(ctx) {
    if (ctx.args.skipProgress) {
      ctx.io.log("Skipped (--skip-progress).");
      (ctx.summary.skippedOptional ??= []).push("progress");
      return;
    }
    ctx.summary.progress = await optionalCapture(ctx, {
      label: "progress",
      flag: "--progress",
      parse: parseProgressSummary,
      isNew: (c) => hasNewRows(c.roster, c.lessons),
      question: "Write the progress the dry run found to the database (Bronze only; the Hub's own progress is not touched yet)?",
      hint: "Read the lines above, then re-run; it only redoes what is missing.",
    });
  },
};

const stepProgressImport: MigrateStep = {
  id: "P2",
  title: "Progress into the Hub (adds only, optional)",
  async run(ctx) {
    if (ctx.args.skipProgress) {
      ctx.io.log("Skipped (--skip-progress).");
      return;
    }
    if (ctx.summary.progress?.outcome === "failed") {
      ctx.io.log("Skipped: the progress capture failed, so the Hub import would work from a half-captured snapshot. Fix that and re-run.");
      return;
    }
    try {
      const probe = await callStep(ctx, "Step P2 (progress)", "/api/process/course-progress", { course: ctx.slug, dryRun: true }, "Fix that and re-run.");
      const dry = (probe.courses ?? [])[0];
      if (!dry) throw new Error("the route returned no course");
      const counts = { inserted: dry.inserted ?? 0, alreadyCompleted: dry.alreadyCompleted ?? 0, leftAlone: dry.leftAlone ?? 0 };
      ctx.io.log(
        `Dry run: ${counts.inserted} completed lessons would be added, ${counts.alreadyCompleted} already completed in the Hub, ${counts.leftAlone} left alone ` +
          `(members' own rows are never changed); students: ${dry.students?.matched ?? 0} matched, ${dry.students?.unmatched ?? 0} without a member, ` +
          `${dry.students?.ambiguous ?? 0} ambiguous, ${dry.students?.withoutAccess ?? 0} without access.`
      );
      if (counts.inserted === 0) {
        ctx.summary.progressImport = { dryRun: counts, inserted: 0, applied: false };
        ctx.io.log("Nothing to add.");
        return;
      }
      const real = await callStep(ctx, "Step P2 (progress)", "/api/process/course-progress", { course: ctx.slug, dryRun: false }, "Fix that and re-run.");
      const inserted = (real.courses ?? [])[0]?.inserted ?? 0;
      ctx.summary.progressImport = { dryRun: counts, inserted, applied: true };
      ctx.io.log(`Added ${inserted} completed lessons. Insert-only: a member's own progress is never overwritten, so this is safe to repeat.`);
    } catch (error) {
      ctx.failures.push(`progress import into the Hub failed: ${error instanceof Error ? error.message : String(error)}`);
      ctx.io.log("The progress import failed; carrying on with the next step.");
    }
  },
};

const stepComments: MigrateStep = {
  id: "K",
  title: "Lesson comments from Kajabi (opens Chrome, optional, Bronze only)",
  async run(ctx) {
    if (ctx.args.skipComments) {
      ctx.io.log("Skipped (--skip-comments).");
      (ctx.summary.skippedOptional ??= []).push("comments");
      return;
    }
    ctx.summary.comments = await optionalCapture(ctx, {
      label: "comments",
      flag: "--comments",
      parse: parseCommentsSummary,
      isNew: (c) => hasNewRows(c.rows),
      question: "Write the comments the dry run found to Bronze (the next step shows them in the Hub)?",
      hint: "This capture is not verified against the live Kajabi site; videos and files still run. Read the lines above, then re-run.",
    });
  },
};

const stepCommentsImport: MigrateStep = {
  id: "K2",
  title: "Comments into the Hub (optional)",
  async run(ctx) {
    if (ctx.args.skipComments) {
      ctx.io.log("Skipped (--skip-comments).");
      return;
    }
    if (ctx.summary.comments?.outcome === "failed") {
      ctx.io.log("Skipped: the comments capture failed, so the Hub import would work from a half-captured snapshot. Fix that and re-run.");
      return;
    }
    try {
      const probe = await callStep(ctx, "Step K2 (comments)", "/api/process/course-comments", { course: ctx.slug, dryRun: true }, "Fix that and re-run.");
      const dry = (probe.courses ?? [])[0];
      if (!dry) throw new Error("the route returned no course");
      const counts: CommentsImportCounts = {
        inserted: dry.inserted ?? 0,
        updated: dry.updated ?? 0,
        unchanged: dry.unchanged ?? 0,
        unmatchedLessonComments: dry.unmatchedLessonComments ?? 0,
        unmatchedAuthorComments: dry.unmatchedAuthorComments ?? 0,
        ambiguousAuthorComments: dry.ambiguousAuthorComments ?? 0,
      };
      ctx.io.log(
        `Dry run: ${counts.inserted} comments would be added and ${counts.updated} updated, ${counts.unchanged} already the same; ` +
          `${dry.replies ?? 0} replies (${dry.orphanReplies ?? 0} without their comment), ${dry.authors?.matched ?? 0} authors matched to members by their exact Kajabi contact name (${dry.authors?.staff ?? 0} staff, shown as instructors), ` +
          `${counts.unmatchedLessonComments} comments on lessons the Hub doesn't have, ${dry.skipped ?? 0} skipped. Nobody is notified and nobody follows a lesson because of this.`
      );
      // Names the match could not settle are listed, never guessed (the owner reads them here; they are not logged anywhere else).
      for (const [label, list, total] of [
        ["No member has this name", dry.unmatchedAuthors, counts.unmatchedAuthorComments],
        ["More than one member could be this name", dry.ambiguousAuthors, counts.ambiguousAuthorComments],
      ] as const) {
        if (!total) continue;
        ctx.io.log(`${label}, so ${total} comments are left out:`);
        for (const a of (list ?? []).slice(0, 25)) ctx.io.log(`  ${a.name} (${a.comments} comments${a.members ? `, ${a.members} members` : ""})`);
        if ((list ?? []).length > 25) ctx.io.log(`  ... and ${(list ?? []).length - 25} more names`);
      }
      if (counts.inserted + counts.updated === 0) {
        ctx.summary.commentsImport = { dryRun: counts, written: 0, applied: false };
        ctx.io.log("Nothing to add.");
        return;
      }
      if (!ctx.args.yes && !(await ctx.io.confirm("Write these comments into the Hub's lesson threads (members with access see them once lesson comments are on)?"))) {
        ctx.summary.commentsImport = { dryRun: counts, written: 0, applied: false };
        ctx.io.log("Skipped writing the comments. Nothing changed; run the command again to import them.");
        return;
      }
      const real = await callStep(ctx, "Step K2 (comments)", "/api/process/course-comments", { course: ctx.slug, dryRun: false }, "Fix that and re-run.");
      const done = (real.courses ?? [])[0];
      const written = (done?.inserted ?? 0) + (done?.updated ?? 0);
      ctx.summary.commentsImport = { dryRun: counts, written, applied: true };
      ctx.io.log(`Wrote ${written} comments. Keyed on Kajabi's own ids, so this is safe to repeat.`);
    } catch (error) {
      ctx.failures.push(`comments import into the Hub failed: ${error instanceof Error ? error.message : String(error)}`);
      ctx.io.log("The comments import failed; carrying on with the next step.");
    }
  },
};

/** Asks until the answer parses, three tries. */
async function askUntil<T>(ctx: Context, question: string, parse: (text: string) => T | undefined): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const value = parse(await ctx.io.ask(question));
    if (value !== undefined) return value;
    ctx.io.log("That isn't something I understand, try again.");
  }
  throw new MigrateStop("Couldn't read an answer. Re-run and give --access-duration and --launch-on instead.");
}

const stepC: MigrateStep = {
  id: "C",
  title: "Process into the Hub",
  async run(ctx) {
    const hint = "Fix that and re-run.";
    // First pass: refresh the Hub's copy (a new course is created as a draft) and learn its slug and state. Flags that were given are saved now.
    const first = await callStep(
      ctx,
      "Step C",
      "/api/process/courses",
      {
        kajabiCourseId: ctx.args.courseId,
        ...(ctx.args.accessDuration !== undefined ? { accessDuration: ctx.args.accessDuration } : {}),
        ...(ctx.args.launchOn !== undefined ? { launchOn: ctx.args.launchOn } : {}),
      },
      hint
    );
    let entry = (first.courses ?? [])[0];
    if (!entry) throw new MigrateStop(`Step C returned nothing for course ${ctx.args.courseId}. Re-run step A, then this.`);
    ctx.slug = entry.slug;

    if (entry.isDraft) {
      // Publishing decides what members see and for how long, so it is asked, never guessed.
      if (ctx.args.yes && (ctx.args.accessDuration === undefined || ctx.args.launchOn === undefined)) {
        throw new MigrateStop(
          `"${entry.slug}" isn't published yet, and publishing needs its access length and launch day. ` +
            `With --yes, give both: --access-duration "1 year" (or lifetime) and --launch-on YYYY-MM-DD. Nothing was published.`
        );
      }
      ctx.io.log(`"${entry.slug}" isn't published to members yet.`);
      const accessDuration =
        ctx.args.accessDuration !== undefined
          ? ctx.args.accessDuration
          : await askUntil(ctx, 'How long do members keep access? ("1 year", "6 months", or "lifetime")', parseAccessDuration);
      const launchOn =
        ctx.args.launchOn !== undefined
          ? ctx.args.launchOn
          : await askUntil<string | null>(ctx, "Day the course opens, YYYY-MM-DD in Eastern time (blank: no launch date, open at once)", (text) =>
              text === "" ? null : isValidDay(text) ? text : undefined
            );
      if (!ctx.args.yes) {
        const access = accessDuration ?? "lifetime access";
        const when = launchOn ? `opening ${launchOn}` : "open immediately";
        if (!(await ctx.io.confirm(`Publish "${entry.slug}" to members (${access}, ${when})?`))) {
          ctx.summary.course = { slug: entry.slug, published: false, justPublished: false };
          throw new MigrateStop(`Stopped before publishing "${entry.slug}". It stays a draft. Run the command again when you are ready.`, "declined");
        }
      }
      const published = await callStep(
        ctx,
        "Step C (publish)",
        "/api/process/courses",
        { kajabiCourseId: ctx.args.courseId, publish: true, accessDuration, ...(launchOn ? { launchOn } : {}) },
        hint
      );
      entry = (published.courses ?? [])[0] ?? entry;
      ctx.summary.course = { slug: entry.slug, published: true, justPublished: true };
    } else {
      ctx.summary.course = { slug: entry.slug, published: true, justPublished: false };
    }
    ctx.io.log(`"${entry.slug}": ${entry.modules} modules, ${entry.lessons} lessons for members (${entry.comingSoon} coming soon, ${entry.hiddenLessons} hidden), access for ${entry.access?.members ?? 0} members.`);
  },
};

const stepFiles: MigrateStep = {
  id: "D1",
  title: "Downloads and images",
  async run(ctx) {
    const result = await callStep(ctx, "Step D (files)", "/api/process/course-files", { course: ctx.slug }, "Fix that and re-run.");
    const failed = (result.failed ?? []).length;
    ctx.summary.files = {
      copied: (result.copied ?? []).length,
      alreadyCopied: result.alreadyCopied ?? 0,
      removed: result.removed ?? 0,
      needsNewLink: (result.needsNewLink ?? []).length,
      waitingForLesson: result.waitingForLesson ?? 0,
      failed,
    };
    const images = result.images;
    if (images) {
      const imageFailed = (images.failed ?? []).length;
      ctx.summary.images = { stored: images.copied ?? 0, failed: imageFailed };
      if (imageFailed > 0) ctx.failures.push(`${imageFailed} images could not be copied`);
    }
    if (failed > 0) ctx.failures.push(`${failed} downloads could not be copied`);
    const f = ctx.summary.files;
    ctx.io.log(`Downloads: ${f.copied} copied, ${f.alreadyCopied} already there, ${f.removed} removed.`);
    if (f.needsNewLink > 0) ctx.io.log(`${f.needsNewLink} download links expired: run the command again (step B refreshes them).`);
  },
};

type PlannedVideoRow = { mediaId: string; draft: boolean; state: string; durationSeconds: number | null; videoStatus: string | null };

async function planVideos(ctx: Context): Promise<PlannedVideoRow[]> {
  const result = await callStep(ctx, "Step D (videos)", "/api/process/course-media", { course: ctx.slug, action: "plan" }, "Fix that and re-run.");
  return result.videos ?? [];
}

const readyToUpload = (videos: PlannedVideoRow[]) => videos.filter((v) => !v.draft && v.state === "ready_to_upload");

const stepVideos: MigrateStep = {
  id: "D2",
  title: "Videos to Mux (billed)",
  async run(ctx) {
    let videos = await planVideos(ctx);
    const visible = videos.filter((v) => !v.draft);
    const summary = {
      total: visible.length,
      alreadyInMux: visible.filter((v) => v.state === "uploaded").length,
      uploaded: 0,
      pending: 0,
      needsNewLink: visible.filter((v) => v.state === "link_expired" || v.state === "no_link").length,
      failed: 0,
      draftsSkipped: videos.filter((v) => v.draft && v.state !== "uploaded").length,
      minutes: 0,
    };
    ctx.summary.videos = summary;

    let todo = readyToUpload(videos);
    summary.minutes = Math.round(todo.reduce((sum, v) => sum + (v.durationSeconds ?? 0), 0) / 60);
    summary.pending = todo.length + summary.needsNewLink;
    if (summary.needsNewLink > 0) ctx.io.log(`${summary.needsNewLink} videos have no usable download link: run the command again (step B refreshes them).`);
    if (summary.draftsSkipped > 0) ctx.io.log(`${summary.draftsSkipped} videos belong only to draft lessons and are not uploaded here (use the admin course page to pick them).`);

    if (todo.length === 0) {
      ctx.io.log("No videos to upload.");
    } else {
      ctx.io.log(`${todo.length} videos, ${summary.minutes} minutes to upload to Mux.`);
      if (!ctx.args.yes && !(await ctx.io.confirm(`Upload ${todo.length} videos (${summary.minutes} minutes)? Mux bills for every upload.`))) {
        throw new MigrateStop(`Stopped before uploading ${todo.length} videos. Nothing was uploaded or billed. Run the command again when you are ready.`, "declined");
      }

      // Each call is capped at 300 seconds on the server, so keep going until nothing is left or a round makes no progress.
      let lastFailed: { mediaId: string; error: string }[] = [];
      for (let round = 1; round <= MAX_UPLOAD_ROUNDS && todo.length > 0; round++) {
        const before = todo.length;
        try {
          const result = await call(ctx, "/api/process/course-media", { course: ctx.slug, action: "upload" });
          summary.uploaded += (result.upload?.uploaded ?? []).length;
          lastFailed = result.upload?.failed ?? [];
        } catch (error) {
          // A timed-out call may still have uploaded some: look again before deciding.
          if (!(error instanceof ApiError)) throw error;
          if (error.status !== 504 && error.status !== 524) throw new MigrateStop(`Step D (videos) failed: ${error.message}. Fix that and re-run.`);
          ctx.io.log(`Upload round ${round} ended early (${error.message}); checking what is left.`);
        }
        videos = await planVideos(ctx);
        todo = readyToUpload(videos);
        ctx.io.log(`Round ${round}: ${todo.length} videos left.`);
        if (todo.length >= before) break;
      }
      summary.failed = lastFailed.length;
      for (const f of lastFailed) ctx.failures.push(`video ${f.mediaId}: ${f.error}`);
      summary.pending = todo.length + summary.needsNewLink;
    }

    if (summary.uploaded > 0 || videos.some((v) => v.videoStatus === "preparing")) {
      // Same as the panel's "Update status": reads Mux directly, in case its webhook hasn't arrived.
      await callStep(ctx, "Step D (status)", "/api/process/course-media", { course: ctx.slug, action: "refresh" }, "The uploads are in Mux; run the command again to update their status.");
    }
  },
};

/** The steps in order. A quiz step would go between B and C; the optional progress and comments steps follow C (they need its lessons and access rows). */
export function buildSteps(): MigrateStep[] {
  return [stepA, stepB, stepC, stepProgressCapture, stepProgressImport, stepComments, stepCommentsImport, stepFiles, stepVideos];
}

export async function runMigration(args: MigrateArgs, env: MigrateEnvironment, io: MigrateIO, steps: MigrateStep[] = buildSteps()): Promise<MigrateResult> {
  const ctx: Context = { args, env, io, summary: {}, failures: [], slug: null };
  let stopped: MigrateResult["stopped"] = null;
  for (const step of steps) {
    io.log(`\n== Step ${step.id}: ${step.title}`);
    try {
      await step.run(ctx);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      stopped = { step: step.id, kind: error instanceof MigrateStop ? error.kind : "failed", message };
      break;
    }
  }
  return { ok: stopped === null && ctx.failures.length === 0, stopped, failures: ctx.failures, summary: ctx.summary };
}

/** The closing report, one line per fact; steps that did not run are said so. */
export function formatSummary(result: MigrateResult): string[] {
  const { summary: s } = result;
  const lines = ["", "== Summary"];
  if (s.structure) lines.push(`Structure: "${s.structure.title}", ${s.structure.modules} modules, ${s.structure.lessons} lessons.`);
  if (s.content) {
    const c = s.content.counts;
    if (!c) lines.push(`Lesson content: ${s.content.applied ? "written" : "not written"} (the capture's totals line couldn't be read).`);
    else
      lines.push(
        `Lesson content: ${c.updated} captured${s.content.applied ? "" : " (dry run, not written)"}, ${c.linksRefreshed} links refreshed, ${c.unchanged} unchanged, ` +
          `${c.quizzesSkipped} quizzes skipped, ${c.notInBronze} not in Bronze, ${c.failed} failed.`
      );
  }
  if (s.course) lines.push(`Course "${s.course.slug}": ${s.course.justPublished ? "published now" : s.course.published ? "already published" : "still a draft"}.`);
  if (s.skippedOptional?.includes("progress")) lines.push("Progress: skipped (--skip-progress).");
  if (s.progress) {
    const c = s.progress.counts;
    const what = { applied: "captured to Bronze", nothing_new: "nothing new in Bronze", declined: "not written (declined)", failed: "capture failed" }[s.progress.outcome];
    lines.push(
      `Progress: ${what}` +
        (c ? ` (roster ${c.roster.written} written, ${c.roster.unchanged} unchanged, ${c.roster.removed} removed; lessons ${c.lessons.written} written, ${c.lessons.unchanged} unchanged, ${c.lessons.removed} removed).` : ".")
    );
  }
  if (s.progressImport) {
    const p = s.progressImport;
    lines.push(
      `Progress in the Hub: ${p.inserted} completed lessons added${p.applied ? "" : " (nothing to add)"}, ${p.dryRun.alreadyCompleted} already completed, ${p.dryRun.leftAlone} left alone. ` +
        "Insert-only: a member's own progress is never overwritten, and a re-run adds nothing twice."
    );
  }
  if (s.skippedOptional?.includes("comments")) lines.push("Comments: skipped (--skip-comments).");
  if (s.comments) {
    const c = s.comments.counts;
    const captured = s.comments.outcome === "applied" || s.comments.outcome === "nothing_new";
    lines.push(
      captured
        ? "Comments: captured to Bronze." + (c ? ` (${c.rows.written} written, ${c.rows.unchanged} unchanged, ${c.rows.removed} removed.)` : "")
        : `Comments: ${s.comments.outcome === "declined" ? "not written (declined)" : "capture failed"}.`
    );
  }
  if (s.commentsImport) {
    const c = s.commentsImport;
    lines.push(
      `Comments in the Hub: ${c.written} written${c.applied ? "" : " (nothing written)"}, ${c.dryRun.unchanged} already the same, ${c.dryRun.unmatchedLessonComments} on lessons the Hub doesn't have, ${c.dryRun.unmatchedAuthorComments + c.dryRun.ambiguousAuthorComments} left out because their author's name matched no member or several. ` +
        "Keyed on Kajabi's ids, so a re-run adds nothing twice; nobody is notified."
    );
  }
  if (s.files) lines.push(`Downloads: ${s.files.copied} copied, ${s.files.alreadyCopied} already there, ${s.files.removed} removed, ${s.files.failed} failed.`);
  if (s.images) lines.push(`Images: ${s.images.stored} stored, ${s.images.failed} failed.`);
  if (s.videos) {
    const v = s.videos;
    lines.push(`Videos: ${v.uploaded} uploaded now, ${v.alreadyInMux} already in Mux, ${v.pending} pending, ${v.failed} failed, ${v.draftsSkipped} draft-only left alone.`);
  }
  for (const f of result.failures) lines.push(`Failed: ${f}`);
  if (result.stopped) {
    lines.push("", `${result.stopped.kind === "declined" ? "Stopped" : "STOPPED"} at step ${result.stopped.step}: ${result.stopped.message}`);
  } else if (result.failures.length > 0) {
    lines.push("", "Finished, but some items failed (above). Run the command again; it only retries what is missing.");
  } else {
    lines.push("", "All steps finished.");
  }
  return lines;
}

/** The dev server `pnpm dev` starts: the target of a run against the local stack. */
export const LOCAL_APP_URL = "http://localhost:3000";

/**
 * Where the routes are and the secret that opens them. `--base-url` wins; otherwise `.env.prod` means the
 * deployed app and any other env file means the local dev server. The secret is the cron secret when the
 * file has one, else the service role key (the routes accept either).
 */
export function resolveEnvironment(
  args: Pick<MigrateArgs, "envFile" | "baseUrl">,
  values: Record<string, string | undefined>,
  appUrl: string
): MigrateEnvironment | { error: string } {
  const secret = values.CRON_SECRET || values.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) return { error: `${args.envFile} has neither CRON_SECRET nor SUPABASE_SERVICE_ROLE_KEY, so the course routes can't be called.` };
  const isProd = /(^|\/)\.env\.prod$/.test(args.envFile);
  return { baseUrl: args.baseUrl ?? (isProd ? appUrl : LOCAL_APP_URL), secret };
}
