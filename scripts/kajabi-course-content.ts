/**
 * Step B of the Kajabi course migration (docs/product/COURSES.md): captures each lesson's HTML, thumbnail,
 * video source and downloads from Kajabi's admin lesson editor into Bronze.
 *
 * None of that is in Kajabi's public API. The editor gets it from Kajabi's admin, which only answers
 * the editor's own authenticated requests (a plain request with the session cookies gets 401). So
 * this opens a real Chrome window, lets you log in to Kajabi yourself, then opens each lesson's
 * editor and records what it loads (the lesson as an API response or embedded in the editor page,
 * whichever Kajabi serves; the downloads as an API response). The script never sees or stores a
 * password or a token; the login lives in the browser profile directory.
 *
 * With --hero it also looks for the course's hero banner (the image behind the course title). That is experimental and
 * finds nothing today: the admin product page doesn't carry it; the banner is on the member-facing course page.
 *
 * With --progress it captures every student's per-lesson completion instead (docs/product/COURSES.md, "Importing Kajabi
 * per-lesson progress"): the Product Progress report page gives the roster, then each student's report is fetched
 * from inside the logged-in page. The roster feeds bronze.kajabi_product_progress, the lessons feed
 * bronze.kajabi_lesson_progress; /api/process/course-progress turns completed lessons into lesson_progress.
 *
 * With --comments it captures each lesson's comments and replies instead (docs/product/COURSES.md, "Lesson comments"): the
 * admin's posts list gives every lesson's member-page link, each page is opened and "Show More" pressed until it is
 * gone, and the comments go to bronze.kajabi_lesson_comments. It never types or submits anything.
 *
 * With --responses it captures members' PAST QUIZ RESPONSES instead (docs/product/COURSES.md, "Importing past quiz responses"): for
 * each quiz the lesson capture found, it opens the quiz's Results tab, opens each submission through its "Grade quiz" control (it
 * only reads: it never presses Publish grade, Pass, Fail or anything that writes in Kajabi), keeps each submission's answers and
 * the member's email (no name) in bronze.kajabi_quiz_responses, and copies every uploaded file into the Hub's private storage
 * (Kajabi's links expire). Only counts are printed. /api/process/quiz-responses turns them into quiz attempts for the members.
 *
 * Run step A (/api/import/kajabi-courses) first: this only fills in lessons Bronze already has.
 *
 * Usage:
 *   npm run courses:content -- --course <kajabi-course-id> [--apply] [--env .env.prod]
 *   npm run courses:content -- --course <kajabi-course-id> --skip-drafts
 *   npm run courses:content -- --course <kajabi-course-id> --progress [--apply]
 *   npm run courses:content -- --course <kajabi-course-id> --comments [--apply]
 *   npm run courses:content -- --course <kajabi-course-id> --responses [--apply]
 * Without --apply it captures and reports what it would change, and writes nothing. Re-running is
 * safe: a lesson whose content hasn't changed is skipped. Writes use the service role.
 */

import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { chromium, type BrowserContext, type Page, type Response } from "playwright";
import {
  isQuizRedirect,
  parseEmbeddedPost,
  parseLessonContent,
  saveLessonContent,
  selectLessons,
  type EditorDownloads,
  type EditorPost,
  type LessonTarget,
  type SaveOutcome,
} from "../src/lib/kajabi/lesson-content";
import { findCourseHero, imageFieldNames, saveCourseHero } from "../src/lib/kajabi/course-hero";
import { embeddedDocuments, parseKajabiQuiz, quizIdOfRedirect, quizContentHash, retireQuizzesOfLesson, saveQuizCapture, type QuizSaveOutcome } from "../src/lib/kajabi/quiz-capture";
import { describeDomShape, describeJson, describeMarkup, formatProbe, loginHint, normalizeRequestPath, queryNames, type ProbedRequest } from "../src/lib/kajabi/probe";
import { ORG_TIMEZONE } from "../src/lib/config";
import { ProgressSessionExpiredError, runProgressCapture } from "../src/lib/kajabi/progress-run";
import { describeRosterResponse, forwardableHeaders, rosterHasMembers } from "../src/lib/kajabi/progress-capture";
import { extractCommentsInPage, parsePostsList, type PostLink } from "../src/lib/kajabi/comments-capture";
import { CommentsSessionExpiredError, runCommentsCapture, type LessonRead } from "../src/lib/kajabi/comments-run";
import { formatCommentsTotals, formatContentTotals, formatProgressTotals } from "../src/lib/kajabi/capture-totals";
import { QUIZ_ANSWER_FILES_BUCKET } from "../src/lib/courses/quiz-files";
import { SupabaseKajabiCourseRepository } from "../src/lib/data/kajabi-courses";
import { submissionsListedIn, type FileCopyIO } from "../src/lib/kajabi/quiz-responses";
import { formatResponsesTotals, ResponsesSessionExpiredError, runResponsesCapture, type QuizRead, type QuizToRead } from "../src/lib/kajabi/quiz-responses-run";
import { loadLayeredEnv } from "./load-layered-env";
import { CONTENT_USAGE, parseContentArgs } from "./kajabi-course-content-args";

const KAJABI_APP = "https://app.kajabi.com";
const LOGIN_WAIT_MS = 10 * 60 * 1000;
const RESPONSE_TIMEOUT_MS = 60_000;
// Comments: the most times "Show More" is pressed on one lesson, and how long to wait for a page or for more comments.
const MAX_SHOW_MORE_PRESSES = 200;
const COMMENTS_PAGE_TIMEOUT_MS = 60_000;
const COMMENTS_LIST_TIMEOUT_MS = 20_000;
const SHOW_MORE_TIMEOUT_MS = 15_000;
// The Product Progress report is built in the background: how long to wait for it, and how often to ask again.
const ROSTER_WAIT_MS = 90_000;
const ROSTER_REASK_MS = 4_000;
// Nothing the capture needs: skipping them makes each editor load much lighter.
const SKIPPED_RESOURCES = new Set(["image", "media", "font"]);

class SessionExpiredError extends Error {}
/** The lesson is a Kajabi quiz: its editor is a quiz editor, with no lesson text, video or downloads to capture; `quizId` is the quiz editor's id. */
class QuizLessonError extends Error {
  constructor(readonly quizId: string | null) {
    super("a Kajabi quiz");
  }
}
// The quiz editor's own API calls that follow its page: how long to let them arrive before reading what was recorded.
const QUIZ_SETTLE_MS = 3_000;

const parsed = parseContentArgs(process.argv.slice(2));
if (!parsed.ok) {
  console.error(`${parsed.error}\n\n${CONTENT_USAGE}`);
  process.exit(1);
}
const args = parsed;

// Probe mode reads no lessons and writes nothing, so it needs no database settings. Otherwise the env file is
// layered over the .env.shared beside it (like the sync scripts), so --env .env.prod also sees shared values.
if (!args.probe) {
  try {
    loadLayeredEnv(resolve(process.cwd(), args.envFile));
  } catch (error) {
    console.error(`Failed to load ${args.envFile}: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!args.probe && (!url || !key)) {
  console.error(`${args.envFile} (or the .env.shared beside it) needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.`);
  process.exit(1);
}
const supabase = createClient(url ?? "https://probe.invalid", key ?? "probe", { auth: { autoRefreshToken: false, persistSession: false } });

async function ensureLoggedIn(context: BrowserContext): Promise<void> {
  const page = await context.newPage();
  await page.goto(KAJABI_APP);
  let told = false;
  const deadline = Date.now() + LOGIN_WAIT_MS;
  while (!new URL(page.url()).pathname.startsWith("/admin/")) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for the Kajabi login.");
    if (!told) {
      console.log("Log in to Kajabi in the browser window. The script waits and never sees your password.");
      told = true;
    }
    await page.waitForTimeout(2000);
  }
  await page.close();
}

const pathOf = (r: Response) => new URL(r.url()).pathname;

/**
 * A page sitting on the course's admin screen. The lesson editor only fetches its JSON when it is
 * reached from inside the app: loading /admin/posts/{id}/edit directly delivers the lesson some
 * other way and never makes the request. So each worker loads the course page once, then moves
 * from lesson to lesson through the app's own router.
 */
async function openCoursePage(context: BrowserContext, courseId: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`${KAJABI_APP}/admin/products/${courseId}`, { waitUntil: "domcontentloaded" });
  if (!new URL(page.url()).pathname.startsWith("/admin/")) {
    await page.close();
    throw new SessionExpiredError("The Kajabi login expired. Run again and log in.");
  }
  // The app's own requests have settled once it is ready to route; don't fail if it never idles.
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
  return page;
}

/**
 * The course's hero banner: not in the public API, so it is read from what the admin product page loads.
 * Which request carries it isn't documented, so every JSON response the page makes about this course (the
 * path or the request body names the course id) is searched for a hero-like image URL. On a miss it prints
 * what it saw (request paths, the JSON image-field names, and the images on the page, none with their query
 * strings), which is what to read to point `findCourseHero` at the right field. A miss is reported, never
 * fatal: the lessons are still worth capturing.
 */
async function captureHero(context: BrowserContext, courseId: string): Promise<void> {
  const page = await context.newPage();
  const seen = new Set<string>();
  const fieldNames = new Set<string>();
  const pending: Promise<void>[] = [];
  let found: { url: string; key: string; path: string } | null = null;
  page.on("response", (r) => {
    if (!(r.headers()["content-type"] ?? "").includes("json")) return;
    if (!pathOf(r).includes(courseId) && !r.request().postData()?.includes(courseId)) return;
    pending.push(
      (async () => {
        seen.add(`${r.request().method()} ${r.status()} ${pathOf(r)}`);
        if (r.status() === 401) throw new SessionExpiredError("Kajabi answered 401: the login expired. Run again and log in.");
        const json = await r.json().catch(() => undefined);
        if (json === undefined) return;
        for (const name of imageFieldNames(json)) fieldNames.add(name);
        const hero = findCourseHero(json);
        if (hero && !found) found = { ...hero, path: pathOf(r) };
      })()
    );
  });
  try {
    await page.goto(`${KAJABI_APP}/admin/products/${courseId}`, { waitUntil: "domcontentloaded" });
    if (!new URL(page.url()).pathname.startsWith("/admin/")) throw new SessionExpiredError("The Kajabi login expired. Run again and log in.");
    await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => undefined);
    await Promise.all(pending);

    if (!found) {
      const pageImages = await page
        .evaluate(() => {
          const urls = new Set<string>();
          for (const img of Array.from(document.images)) if (img.src.startsWith("http")) urls.add(img.src.split("?")[0]);
          for (const el of Array.from(document.querySelectorAll<HTMLElement>("*"))) {
            const m = getComputedStyle(el).backgroundImage.match(/url\("?(https?:[^")]+)/);
            if (m) urls.add(m[1].split("?")[0]);
          }
          return Array.from(urls).slice(0, 15);
        })
        .catch(() => [] as string[]);
      console.log(
        `hero ${courseId}: none found.\n  JSON about this course: ${[...seen].join("; ") || "none"}\n  image fields in it: ${[...fieldNames].sort().join(", ") || "none"}\n  images on the page: ${pageImages.join(", ") || "none"}`
      );
      return;
    }
    const hero: { url: string; key: string; path: string } = found;
    const outcome = await saveCourseHero(supabase, courseId, hero.url, new Date(), { dryRun: !args.apply });
    console.log(`hero ${courseId}: ${outcome} (from ${hero.path}, ${hero.key})`);
  } catch (error) {
    if (error instanceof SessionExpiredError) throw error;
    console.log(`hero ${courseId}: failed (${error instanceof Error ? error.message : error})`);
  } finally {
    await page.close().catch(() => undefined);
  }
}

/**
 * Moves the open page to the lesson's editor through the app's router and records what it loads.
 *
 * The lesson itself arrives one of two ways, and either is accepted: the editor's own
 * `/api/admin/posts/{id}` call (how Kajabi's admin worked until November 2026), or the editor page,
 * fetched as HTML with the same document embedded in it (`parseEmbeddedPost`). The downloads are
 * still their own `/downloads` call.
 */
async function capture(page: Page, lessonId: string): Promise<{ post: EditorPost; downloads: EditorDownloads }> {
  const wait = (path: string) =>
    page.waitForResponse((r) => r.request().method() === "GET" && pathOf(r) === path, { timeout: RESPONSE_TIMEOUT_MS });
  const checked = (r: Response) => {
    if (r.status() === 401) throw new SessionExpiredError("Kajabi answered 401: the login expired. Run again and log in.");
    if (r.status() === 404) throw new Error("Kajabi has no such lesson (404)");
    if (!r.ok()) throw new Error(`Kajabi answered ${r.status()}`);
    return r;
  };
  const apiResponse = wait(`/api/admin/posts/${lessonId}`);
  const pageResponse = wait(`/admin/posts/${lessonId}/edit`);
  const downloadsResponse = wait(`/api/admin/posts/${lessonId}/downloads`);
  // A response that never arrives would otherwise be an unhandled rejection.
  for (const pending of [apiResponse, pageResponse, downloadsResponse]) pending.catch(() => undefined);

  await page.evaluate((id) => {
    history.pushState({}, "", `/admin/posts/${id}/edit`);
    window.dispatchEvent(new PopStateEvent("popstate", { state: {} }));
  }, lessonId);

  const fromApi = apiResponse.then(async (r) => (await checked(r).json()) as EditorPost);
  const fromPage = pageResponse.then(async (r) => {
    const post = parseEmbeddedPost(await checked(r).text());
    if (!post) throw new Error("the lesson page came back without its lesson data (is the login still valid?)");
    return post;
  });
  // A quiz's editor page redirects to the quiz editor. Stop at once instead of waiting out the other responses
  // (which never come); a page that isn't a quiz leaves this pending, and the content below settles the race.
  const never = () => new Promise<never>(() => undefined);
  const quizRedirect = pageResponse.then(
    (r) => (isQuizRedirect(r.status(), r.headers()["location"]) ? Promise.reject(new QuizLessonError(quizIdOfRedirect(r.headers()["location"]))) : never()),
    // The page response not arriving is an ordinary failure, reported by the content below, not a quiz.
    never
  );
  quizRedirect.catch(() => undefined);

  const content = Promise.all([
    Promise.any([fromApi, fromPage]).catch((error: unknown) => {
      if (!(error instanceof AggregateError)) throw error;
      // A session problem is the useful thing to say, whichever source reported it.
      const expired = error.errors.find((e) => e instanceof SessionExpiredError);
      if (expired) throw expired;
      throw new Error(`no lesson data arrived, neither from /api/admin/posts/{id} nor in the lesson page (${error.errors.map((e) => (e instanceof Error ? e.message : String(e))).join("; ")})`);
    }),
    downloadsResponse,
  ]);
  const [post, downloads] = await Promise.race([content, quizRedirect]);
  return { post, downloads: (await checked(downloads).json()) as EditorDownloads };
}

interface LessonResult {
  lesson: LessonTarget;
  outcome: SaveOutcome | "failed" | "quiz";
  /** For a failure, why; for a quiz, a note. */
  error?: string;
  warnings: string[];
  /** For a quiz: what was written to Bronze, and how many questions the reading found (null when it found none). */
  quiz?: { save: QuizSaveOutcome; questions: number | null };
}

/**
 * Captures a quiz lesson: opens the quiz editor (`/admin/quizzes/{id}/edit`) through the app's router, like a lesson's editor,
 * and keeps the JSON it brings: the editor page's embedded store and every quiz-looking `/api/admin/` response it makes while
 * it settles. The documents go to Bronze as they came (the reading is `parseKajabiQuiz`, a reprocess away), and when the
 * reading finds no question the field names and types are printed (never values) so it can be fixed from facts.
 * Unverified against the live admin: docs/product/COURSES.md, "Importing quizzes from Kajabi".
 */
async function captureQuiz(page: Page, lesson: LessonTarget, quizId: string): Promise<{ save: QuizSaveOutcome; questions: number | null; shape: string[] }> {
  const documents: unknown[] = [];
  const onResponse = async (r: Response) => {
    if (r.request().method() !== "GET" || r.status() !== 200) return;
    const path = pathOf(r);
    if (!path.startsWith("/api/admin/") || !/quiz|assessment|question|answer/i.test(path)) return;
    if (!(r.headers()["content-type"] ?? "").includes("json")) return;
    try {
      documents.push(await r.json());
    } catch {
      /* not JSON after all */
    }
  };
  page.on("response", onResponse);
  try {
    const pageResponse = page.waitForResponse((r) => r.request().method() === "GET" && pathOf(r) === `/admin/quizzes/${quizId}/edit`, { timeout: RESPONSE_TIMEOUT_MS });
    pageResponse.catch(() => undefined);
    await page.evaluate((id) => {
      history.pushState({}, "", `/admin/quizzes/${id}/edit`);
      window.dispatchEvent(new PopStateEvent("popstate", { state: {} }));
    }, quizId);
    const response = await pageResponse;
    if (response.status() === 401) throw new SessionExpiredError("Kajabi answered 401: the login expired. Run again and log in.");
    if (!response.ok()) throw new Error(`Kajabi answered ${response.status()} for the quiz editor`);
    documents.push(...embeddedDocuments(await response.text()));
    await page.waitForTimeout(QUIZ_SETTLE_MS);
  } finally {
    page.off("response", onResponse);
  }
  if (documents.length === 0) throw new Error("the quiz editor loaded no JSON (is the login still valid, or did the page change?)");

  const parsed = parseKajabiQuiz(documents);
  const save = await saveQuizCapture(supabase, { quizKajabiId: quizId, courseKajabiId: lesson.course_kajabi_id, lessonKajabiId: lesson.kajabi_id, documents }, new Date(), { dryRun: !args.apply });
  return { save, questions: parsed ? parsed.questions.length : null, shape: parsed ? [] : documents.flatMap((d, i) => describeJson(d).map((line) => `doc ${i + 1}: ${line}`)) };
}

/** A worker's page, reopened when a capture fails so a retry starts from a clean app. */
interface Worker {
  page: Page | null;
}

async function processLesson(context: BrowserContext, worker: Worker, lesson: LessonTarget): Promise<LessonResult> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      worker.page ??= await openCoursePage(context, lesson.course_kajabi_id);
      const { post, downloads } = await capture(worker.page, lesson.kajabi_id);
      if (post.data.id !== lesson.kajabi_id) throw new Error(`Editor returned lesson ${post.data.id}`);
      const content = parseLessonContent(post, downloads);

      const warnings: string[] = [];
      if (content.thumbnailUrl?.includes("X-Amz-Signature")) warnings.push("thumbnail link is signed and will expire");
      if (content.videoSource && !content.videoSource.download_url) warnings.push("video has no download link");

      const outcome = await saveLessonContent(supabase, content, new Date(), { dryRun: !args.apply });
      // A lesson that was a quiz and isn't any more: its Bronze quiz is retired, so the next processing removes it from Silver.
      await retireQuizzesOfLesson(supabase, lesson.kajabi_id, new Date(), { dryRun: !args.apply });
      return { lesson, outcome, warnings };
    } catch (error) {
      if (error instanceof SessionExpiredError) throw error;
      lastError = error;
      // The page is now on another editor (or in an odd state): the next lesson, or the retry, starts from a clean one.
      await worker.page?.close().catch(() => undefined);
      worker.page = null;
      // A quiz has no lesson text, video or downloads: its questions come from the quiz editor instead.
      if (error instanceof QuizLessonError) {
        if (!error.quizId) return { lesson, outcome: "quiz", error: "a Kajabi quiz, but the redirect named no quiz id, so it is left as it is", warnings: [] };
        try {
          worker.page ??= await openCoursePage(context, lesson.course_kajabi_id);
          const quiz = await captureQuiz(worker.page, lesson, error.quizId);
          // The page is on the quiz editor now: the next lesson starts from a clean one.
          await worker.page.close().catch(() => undefined);
          worker.page = null;
          const warnings = quiz.questions === null ? ["captured, but no question could be read from it: the field names and types follow"] : [];
          return { lesson, outcome: "quiz", warnings: [...warnings, ...quiz.shape], quiz: { save: quiz.save, questions: quiz.questions } };
        } catch (quizError) {
          if (quizError instanceof SessionExpiredError) throw quizError;
          await worker.page?.close().catch(() => undefined);
          worker.page = null;
          return { lesson, outcome: "failed", error: `a Kajabi quiz that could not be captured: ${quizError instanceof Error ? quizError.message : String(quizError)}`, warnings: [] };
        }
      }
    }
  }
  return { lesson, outcome: "failed", error: lastError instanceof Error ? lastError.message : String(lastError), warnings: [] };
}

/**
 * Probe mode: opens a page you name (a student's progress page, say) in the logged-in browser, and for a while
 * records every JSON response it makes while you click around in the window (open a week, a module...). Then it
 * prints each request's path and the field names and types of its response: never values, since these pages show
 * members' names and emails. The output says where a page's data comes from, so a capture can be written from
 * facts. Writes nothing, and needs no database.
 */
async function probe(target: { url: string; seconds: number }): Promise<void> {
  const context = await chromium.launchPersistentContext(args.profileDir ?? join(homedir(), ".hub-kajabi-profile"), {
    channel: "chrome",
    headless: args.headless,
  });
  const seen: ProbedRequest[] = [];
  const pending: Promise<void>[] = [];
  // The richest description of each page's comment-related structure seen while recording, by page path.
  const dom = new Map<string, string[]>();
  const sampleDom = async () => {
    for (const p of context.pages()) {
      const path = normalizeRequestPath(p.url());
      if (path === "about:blank" || path === "") continue;
      const lines = await p.evaluate(describeDomShape, "comment").catch(() => [] as string[]);
      if (lines.length >= (dom.get(path)?.length ?? 0)) dom.set(path, lines);
    }
  };
  try {
    await context.route("**/*", (route) => (SKIPPED_RESOURCES.has(route.request().resourceType()) ? route.abort() : route.continue()));
    // tsx compiles functions with a `__name` helper that does not exist in the page, which silently broke the page-structure function: define it.
    await context.addInitScript("window.__name = window.__name || function (fn) { return fn; };");
    await ensureLoggedIn(context);
    // On the whole browser context, so a link that opens a new tab is recorded too (the admin's preview links do).
    context.on("response", (r) => {
      const contentType = (r.headers()["content-type"] ?? "").split(";")[0].trim().toLowerCase();
      const isJson = contentType.includes("json");
      // A page can also load its data as an HTML fragment or a script (Kajabi's member pages do): list those too, by type and path only.
      if (!isJson && !["xhr", "fetch", "document"].includes(r.request().resourceType())) return;
      const type = r.request().resourceType();
      const isMarkup = /^(text\/(html|javascript)|application\/(x-)?javascript)$/.test(contentType) && !/\.(m3u8|ts)$/.test(r.url().split("?")[0]);
      pending.push(
        (async () => {
          let fields: string[] = [];
          if (isJson) {
            const json = await r.json().catch(() => undefined);
            fields = json === undefined ? [] : describeJson(json);
          } else if (isMarkup) {
            // Data that arrives as markup (a script that appends an HTML string, a fragment, a page): its element and attribute names, never text.
            // A whole page is narrowed to the parts that look like comments, a fragment or script is described in full.
            const body = await r.text().catch(() => "");
            fields = body.length > 3_000_000 ? [] : describeMarkup(body, { pattern: type === "document" ? /comment|reply|author|avatar|member|user/i : undefined, maxLines: 40 });
          }
          seen.push({
            method: r.request().method(),
            status: r.status(),
            path: normalizeRequestPath(r.url()),
            query: queryNames(r.url()),
            fields,
            ...(isJson ? {} : { contentType: contentType || "no content type" }),
          });
        })()
      );
    });
    const page = await context.newPage();
    await page.goto(target.url, { waitUntil: "domcontentloaded" });
    console.log(
      `Recording for ${target.seconds} seconds, in every tab. Click around in the browser window (open a link that opens a new tab, open a week, a module, press Show More) so its requests are seen.`
    );
    const end = Date.now() + target.seconds * 1000;
    while (Date.now() < end) {
      await page.waitForTimeout(Math.min(5000, Math.max(0, end - Date.now())));
      await sampleDom();
    }
    await Promise.all(pending);
  } finally {
    await context.close();
  }
  const structure = [...dom.entries()]
    .map(([path, lines]) => `  ${path}\n${lines.length ? lines.map((l) => `    ${l}`).join("\n") : "    nothing"}`)
    .join("\n");
  const hint = loginHint(seen);
  console.log(
    `\n${formatProbe(seen)}\n\nPage structure where it mentions "comment" (per page; element names and attribute names only, never text):\n${structure || "  no page"}${hint ? `\n\n${hint}` : ""}\n\nStarted at: ${normalizeRequestPath(target.url)}. Names and types only, no values.`
  );
}

/**
 * Progress mode. Opens the course's Product Progress report page, records the roster response the page itself
 * requests (which also gives the exact URL and query string to reuse), then fetches each student's report with
 * `fetch` inside that page, so the request carries the session the way the page's own requests do. UNVERIFIED
 * against the live site: if Kajabi refuses these requests, the message names the status and path, never a student.
 */
async function captureProgress(courseId: string): Promise<void> {
  const siteId = process.env.KAJABI_SITE_ID;
  if (!siteId) throw new Error(`${args.envFile} (or the .env.shared beside it) needs KAJABI_SITE_ID.`);
  console.log(`${args.apply ? "Capturing" : "Dry run: capturing"} progress for course ${courseId} from ${args.envFile}`);

  const context = await chromium.launchPersistentContext(args.profileDir ?? join(homedir(), ".hub-kajabi-profile"), {
    channel: "chrome",
    headless: args.headless,
  });
  try {
    await context.route("**/*", (route) => (SKIPPED_RESOURCES.has(route.request().resourceType()) ? route.abort() : route.continue()));
    await ensureLoggedIn(context);
    const page = await context.newPage();
    const rosterPath = `/api/client/reports/product_progress/${courseId}`;
    // Kajabi builds the report in the background, so the page's first answer can be empty and a later one has the
    // students. Watch every roster response and use the first that has students.
    let roster: { url: string; json: unknown } | null = null;
    // The page's own request carries what Kajabi's API checks (a CSRF or authorization header, say): the cookie alone is refused with a 401.
    let pageHeaders: Record<string, string> = {};
    const seen: string[] = [];
    page.on("response", (r) => {
      if (r.request().method() !== "GET" || pathOf(r) !== rosterPath) return;
      void (async () => {
        if (r.status() === 401) return void seen.push("401");
        if (!r.ok()) return void seen.push(`HTTP ${r.status()}`);
        const json = await r.json().catch(() => undefined);
        seen.push(describeRosterResponse(json));
        if (!roster || rosterHasMembers(json)) {
          roster = { url: r.url(), json };
          pageHeaders = forwardableHeaders(await r.request().allHeaders().catch(() => ({})));
        }
      })();
    });
    await page.goto(`${KAJABI_APP}/admin/sites/${encodeURIComponent(siteId)}/reports/product_progress_report?productId=${encodeURIComponent(courseId)}`, {
      waitUntil: "domcontentloaded",
    });
    if (!new URL(page.url()).pathname.startsWith("/admin/")) throw new SessionExpiredError("The Kajabi login expired. Run again and log in.");

    // Wait for a response with students; if the page stops asking, ask again at the same address.
    const deadline = Date.now() + ROSTER_WAIT_MS;
    let lastAsked = Date.now();
    while (Date.now() < deadline && !(roster && rosterHasMembers((roster as { json: unknown }).json))) {
      await page.waitForTimeout(1000);
      const current = roster as { url: string; json: unknown } | null;
      if (current && Date.now() - lastAsked > ROSTER_REASK_MS) {
        lastAsked = Date.now();
        const again = await page.evaluate(
          async ([u, h]) => {
            const response = await fetch(u, { credentials: "include", headers: { accept: "application/json", ...(h as Record<string, string>) } });
            return { status: response.status, json: response.ok ? await response.json().catch(() => undefined) : undefined };
          },
          [current.url, pageHeaders] as const
        );
        if (again.status === 401) throw new SessionExpiredError("Kajabi answered 401: the login expired. Run again and log in.");
        if (again.json !== undefined) {
          seen.push(describeRosterResponse(again.json));
          if (rosterHasMembers(again.json)) roster = { url: current.url, json: again.json };
        }
      }
    }
    const found = roster as { url: string; json: unknown } | null;
    if (!found) {
      throw new Error(`The Product Progress page did not request ${rosterPath} (or it was refused: ${seen.join("; ") || "no response"}). Is the course id right?`);
    }
    if (!rosterHasMembers(found.json)) {
      console.log(`The report returned no students after ${ROSTER_WAIT_MS / 1000} seconds. Its responses: ${seen.join("; ")}.`);
    }

    const summary = await runProgressCapture({
      db: supabase as never,
      courseKajabiId: courseId,
      roster: found,
      fetchReport: (target) =>
        page.evaluate(
          async ([u, h]) => {
            const response = await fetch(u, { credentials: "include", headers: { accept: "application/json", ...(h as Record<string, string>) } });
            const json = response.ok ? await response.json().catch(() => undefined) : undefined;
            return { status: response.status, json };
          },
          [target, pageHeaders] as const
        ),
      refusalHint: `Headers sent with it (names only): ${Object.keys(pageHeaders).join(", ") || "none beyond the cookie"}.`,
      apply: args.apply,
      timeZone: ORG_TIMEZONE,
      concurrency: args.concurrency,
      log: (line) => console.log(line),
    }).catch((error) => {
      if (error instanceof ProgressSessionExpiredError) throw new SessionExpiredError(error.message);
      throw error;
    });

    console.log(formatProgressTotals(args.apply, summary));
    if (summary.membersFailed > 0) process.exitCode = 1;
  } finally {
    await context.close();
  }
}

/**
 * Opens one lesson's member page (the admin's "view comments" link, which carries a preview token), presses Show More
 * until it is gone, and reads the comments. It only navigates and presses Show More: it never types, never submits a
 * form and never clicks Reply or Post Comment. Errors are rethrown with short generic messages, because Playwright's
 * own messages can contain the page address, and that holds the preview token.
 */
async function readCommentsPage(context: BrowserContext, lesson: PostLink): Promise<LessonRead> {
  const page = await context.newPage();
  try {
    let response: Response | null;
    try {
      response = await page.goto(new URL(lesson.url, KAJABI_APP).toString(), { waitUntil: "domcontentloaded", timeout: COMMENTS_PAGE_TIMEOUT_MS });
    } catch {
      throw new Error("the lesson page did not load");
    }
    if (response?.status() === 401 || /(^|\/)(login|sign_in)(\/|$)/.test(new URL(page.url()).pathname)) {
      throw new CommentsSessionExpiredError("Kajabi sent a lesson page to its login screen: the login expired, or the preview link did. Run again and log in.");
    }
    if (response && response.status() >= 400) throw new Error(`Kajabi answered ${response.status()} for the lesson page`);
    const hasList = await page
      .waitForSelector("[data-comments-list]", { state: "attached", timeout: COMMENTS_LIST_TIMEOUT_MS })
      .then(() => true)
      .catch(() => false);
    if (!hasList) {
      // A lesson with no comments still has the box to write one; a page without either is not one we understand.
      const hasCommentBox = (await page.locator("form.new_comment").count()) > 0;
      // "This Post is Locked": the course opens a lesson only after the one before it is complete, and the preview has no progress.
      const locked = !hasCommentBox && (await page.getByText(/post is locked/i).count()) > 0;
      // A quiz or assessment page is questions with radio buttons and has no comments by design.
      const quiz =
        !hasCommentBox && !locked && ((await page.locator('input[type="radio"]').count()) > 0 || (await page.getByText(/^\s*Question\s+1\b/i).count()) > 0);
      return { kind: "noList", hasCommentBox, locked, quiz };
    }

    const more = page.locator("a.btn--more");
    let presses = 0;
    let capped = false;
    let before = await page.locator("div.comment").count();
    while ((await more.count()) > 0) {
      if (presses >= MAX_SHOW_MORE_PRESSES) {
        capped = true;
        break;
      }
      try {
        await more.first().click({ timeout: SHOW_MORE_TIMEOUT_MS });
      } catch {
        throw new Error("Show More could not be pressed");
      }
      presses++;
      const grew = await page
        .waitForFunction((n) => document.querySelectorAll("div.comment").length > n, before, { timeout: SHOW_MORE_TIMEOUT_MS })
        .then(() => true)
        .catch(() => false);
      const after = await page.locator("div.comment").count();
      if (!grew || after <= before) {
        // The press brought nothing: done if the button went away, cut off if it is still there.
        capped = (await more.count()) > 0;
        break;
      }
      before = after;
    }
    return { kind: "ok", page: await page.evaluate(extractCommentsInPage), capped };
  } finally {
    await page.close().catch(() => undefined);
  }
}

/**
 * Comments mode (docs/product/COURSES.md, "Lesson comments"). The course's admin product page requests the posts list
 * itself (`/api/admin/products/{id}/posts`); its response gives every lesson's "view comments" link. Each lesson is
 * then opened in a new page of the same browser and read. UNVERIFIED against the live site: the dry run is the first
 * real test. Prints counts only, never a name, a comment or an address.
 */
async function captureComments(courseId: string): Promise<void> {
  console.log(`${args.apply ? "Capturing" : "Dry run: capturing"} lesson comments for course ${courseId} from ${args.envFile}`);
  const context = await chromium.launchPersistentContext(args.profileDir ?? join(homedir(), ".hub-kajabi-profile"), {
    channel: "chrome",
    headless: args.headless,
  });
  try {
    await context.route("**/*", (route) => (SKIPPED_RESOURCES.has(route.request().resourceType()) ? route.abort() : route.continue()));
    // tsx adds a `__name` helper to functions it compiles; the page has none (see the probe).
    await context.addInitScript("window.__name = window.__name || function (fn) { return fn; };");
    await ensureLoggedIn(context);

    const postsPath = `/api/admin/products/${courseId}/posts`;
    const admin = await context.newPage();
    const postsResponse = admin.waitForResponse((r) => r.request().method() === "GET" && pathOf(r) === postsPath, { timeout: RESPONSE_TIMEOUT_MS });
    postsResponse.catch(() => undefined);
    await admin.goto(`${KAJABI_APP}/admin/products/${courseId}`, { waitUntil: "domcontentloaded" });
    if (!new URL(admin.url()).pathname.startsWith("/admin/")) throw new SessionExpiredError("The Kajabi login expired. Run again and log in.");
    const response = await postsResponse.catch(() => null);
    if (!response) throw new Error(`The course page did not request ${postsPath} within ${RESPONSE_TIMEOUT_MS / 1000} seconds. Is the course id right?`);
    if (response.status() === 401) throw new SessionExpiredError("Kajabi answered 401: the login expired. Run again and log in.");
    if (!response.ok()) throw new Error(`Kajabi answered ${response.status()} for the posts list`);
    const list = parsePostsList(await response.json().catch(() => undefined));
    await admin.close();
    console.log(`The posts list has ${list.lessons.length} lessons with a comments link (${list.withoutLink} without one).`);
    if (list.paged) console.log("Warning: the posts list points at a next page, which this capture does not follow.");

    const summary = await runCommentsCapture({
      db: supabase as never,
      courseKajabiId: courseId,
      lessons: list.lessons,
      readLesson: (lesson) => readCommentsPage(context, lesson),
      apply: args.apply,
      timeZone: ORG_TIMEZONE,
      concurrency: args.concurrency,
      log: (line) => console.log(line),
    }).catch((error) => {
      if (error instanceof CommentsSessionExpiredError) throw new SessionExpiredError(error.message);
      throw error;
    });

    console.log(formatCommentsTotals(args.apply, summary));
    if (summary.lessonsFailed > 0 || summary.lessonsCapped > 0) process.exitCode = 1;
  } finally {
    await context.close();
  }
}

// Responses: how long to let a page's own API calls arrive, the most pages of one Results tab, and how long a file may take.
const RESPONSES_SETTLE_MS = 3_000;
const RESPONSES_MAX_PAGES = 200;
const RESPONSES_NAV_TIMEOUT_MS = 20_000;
const FILE_DOWNLOAD_TIMEOUT_MS = 60_000;

/** The id at the end of a submission page's address, the key that names it. */
const submissionKeyOf = (pathname: string): string | null => /\/([0-9a-f]{8}-[0-9a-f-]{27}|\d+)\/?$/i.exec(pathname)?.[1] ?? null;

/** Collects every JSON response a page makes while it settles, for the quiz results and the submission views. */
function collectJson(page: Page, into: unknown[]): () => void {
  const onResponse = async (r: Response) => {
    if (r.request().method() !== "GET" || r.status() !== 200) return;
    const path = pathOf(r);
    if (!path.startsWith("/api/admin/") || !/quiz|assessment|submission|result|answer|response|attempt|grade/i.test(path)) return;
    if (!(r.headers()["content-type"] ?? "").includes("json")) return;
    try {
      into.push(await r.json());
    } catch {
      /* not JSON after all */
    }
  };
  page.on("response", onResponse);
  return () => page.off("response", onResponse);
}

/**
 * Reads one quiz's Results tab: opens it through the app's router (like the quiz editor), then opens each row's submission with its
 * "Grade quiz" control, collecting the JSON the view loads, and goes back. Reads only. Unverified against the live admin (docs/
 * product/COURSES.md, "Importing past quiz responses"): run `--probe` on the results page first, and the capture prints the field names of
 * anything it cannot read.
 */
async function readQuizResponses(page: Page, quiz: QuizToRead): Promise<QuizRead> {
  const listDocuments: unknown[] = [];
  const stopList = collectJson(page, listDocuments);
  const read: QuizRead = { listed: null, submissions: [], failed: 0, incomplete: false };
  try {
    const resultsPath = `/admin/quizzes/${quiz.quizKajabiId}/results`;
    const pageResponse = page.waitForResponse((r) => r.request().method() === "GET" && pathOf(r) === resultsPath, { timeout: RESPONSE_TIMEOUT_MS });
    pageResponse.catch(() => undefined);
    await page.evaluate((path) => {
      history.pushState({}, "", path);
      window.dispatchEvent(new PopStateEvent("popstate", { state: {} }));
    }, resultsPath);
    const response = await pageResponse;
    if (response.status() === 401) throw new ResponsesSessionExpiredError("Kajabi answered 401: the login expired. Run again and log in.");
    if (!response.ok()) throw new Error(`Kajabi answered ${response.status()} for the results page`);
    listDocuments.push(...embeddedDocuments(await response.text()));
    await page.waitForTimeout(RESPONSES_SETTLE_MS);

    const grade = page.locator('a:has-text("Grade quiz"), button:has-text("Grade quiz")');
    const listedKeys = new Set<string>();
    const opened = new Set<string>();
    for (let pageNumber = 1; pageNumber <= RESPONSES_MAX_PAGES; pageNumber++) {
      for (const ref of submissionsListedIn(listDocuments)) listedKeys.add(ref.submissionKey);
      const rows = await grade.count();
      for (let i = 0; i < rows; i++) {
        const documents: unknown[] = [];
        const stop = collectJson(page, documents);
        try {
          const before = page.url();
          await grade.nth(i).click({ timeout: RESPONSES_NAV_TIMEOUT_MS });
          await page.waitForURL((u) => u.toString() !== before, { timeout: RESPONSES_NAV_TIMEOUT_MS }).catch(() => undefined);
          await page.waitForTimeout(RESPONSES_SETTLE_MS);
          const key = submissionKeyOf(new URL(page.url()).pathname);
          if (key && opened.has(key)) {
            // The same submission twice (a page that came back): once is enough.
          } else {
            if (key) opened.add(key);
            read.submissions.push({ key, documents });
          }
        } catch (error) {
          if (error instanceof ResponsesSessionExpiredError) throw error;
          read.failed++;
        } finally {
          stop();
        }
        await page.goBack().catch(() => undefined);
        await page.waitForTimeout(RESPONSES_SETTLE_MS);
        if ((await grade.count()) < rows) {
          // The list did not come back whole: what is left of this page is not read.
          read.incomplete = true;
          break;
        }
      }
      if (read.incomplete) break;
      const next = page.getByRole("button", { name: /^next/i }).or(page.getByRole("link", { name: /^next/i }));
      if (!(await next.count()) || !(await next.first().isEnabled().catch(() => false))) break;
      listDocuments.length = 0;
      await next.first().click({ timeout: RESPONSES_NAV_TIMEOUT_MS });
      await page.waitForTimeout(RESPONSES_SETTLE_MS);
    }
    read.listed = Math.max(listedKeys.size, read.submissions.length + read.failed);
  } finally {
    stopList();
  }
  return read;
}

/** Downloads a file with the logged-in browser's session (Kajabi's links may need it) and stores copies in the Hub's private bucket. */
function browserFileIO(context: BrowserContext): FileCopyIO {
  return {
    async download(source) {
      try {
        const r = await context.request.get(new URL(source, KAJABI_APP).toString(), { timeout: FILE_DOWNLOAD_TIMEOUT_MS });
        if (r.status() === 401 || r.status() === 403 || r.status() === 410) return { ok: false, failure: "expired" };
        if (!r.ok()) return { ok: false, failure: "http" };
        return { ok: true, bytes: new Uint8Array(await r.body()), contentType: r.headers()["content-type"] ?? null };
      } catch {
        return { ok: false, failure: "network" };
      }
    },
    async upload(path, bytes, contentType) {
      const { error } = await supabase.storage.from(QUIZ_ANSWER_FILES_BUCKET).upload(path, bytes, { contentType: contentType ?? "application/octet-stream", upsert: true });
      return !error;
    },
  };
}

async function captureResponses(courseId: string) {
  const quizzes: QuizToRead[] = (await new SupabaseKajabiCourseRepository(supabase as never).liveQuizzes(courseId)).map((q) => ({ quizKajabiId: q.kajabi_id, courseKajabiId: q.course_kajabi_id }));
  if (quizzes.length === 0) {
    console.log("No quizzes of this course are captured yet: run the lesson capture first (it finds the course's quizzes).");
    return;
  }
  console.log(`${args.apply ? "Capturing" : "Dry run: capturing"} the responses to ${quizzes.length} quiz(zes) from ${args.envFile}. Counts only are printed.`);
  const context = await chromium.launchPersistentContext(args.profileDir ?? join(homedir(), ".hub-kajabi-profile"), {
    channel: "chrome",
    headless: args.headless,
  });
  try {
    await context.route("**/*", (route) => (SKIPPED_RESOURCES.has(route.request().resourceType()) ? route.abort() : route.continue()));
    await context.addInitScript("window.__name = window.__name || function (fn) { return fn; };");
    await ensureLoggedIn(context);
    const page = await openCoursePage(context, courseId);
    const summary = await runResponsesCapture({
      db: supabase as never,
      quizzes,
      readQuiz: (quiz) => readQuizResponses(page, quiz),
      fileIO: browserFileIO(context),
      apply: args.apply,
      log: (line) => console.log(line),
    }).catch((error) => {
      if (error instanceof ResponsesSessionExpiredError) throw new SessionExpiredError(error.message);
      throw error;
    });
    console.log(formatResponsesTotals(args.apply, summary));
    if (summary.quizzesFailed > 0 || summary.unreadable > 0 || summary.openFailed > 0 || Object.keys(summary.files.failed).length > 0) process.exitCode = 1;
    if (args.apply) console.log("The responses reach the members with POST /api/process/quiz-responses (dry run first).");
  } finally {
    await context.close();
  }
}

async function main() {
  if (args.probe) return probe(args.probe);
  if (args.responses) {
    if (!args.scope || !("courseId" in args.scope)) throw new Error("--responses needs --course");
    return captureResponses(args.scope.courseId);
  }
  if (args.progress) {
    if (!args.scope || !("courseId" in args.scope)) throw new Error("--progress needs --course");
    return captureProgress(args.scope.courseId);
  }
  if (args.comments) {
    if (!args.scope || !("courseId" in args.scope)) throw new Error("--comments needs --course");
    return captureComments(args.scope.courseId);
  }
  if (!args.scope) throw new Error("Give --course or --lesson");
  const lessons = await selectLessons(supabase, args.scope, { includeDrafts: !args.skipDrafts });
  if (lessons.length === 0) {
    console.log(
      "No lessons to capture. Step A (/api/import/kajabi-courses) must have imported the course first" +
        (args.skipDrafts ? "; draft lessons are skipped because of --skip-drafts." : ".")
    );
    return;
  }
  console.log(`${args.apply ? "Capturing" : "Dry run: capturing"} ${lessons.length} lesson(s) from ${args.envFile}`);

  const context = await chromium.launchPersistentContext(args.profileDir ?? join(homedir(), ".hub-kajabi-profile"), {
    channel: "chrome",
    headless: args.headless,
  });
  const results: LessonResult[] = [];
  try {
    await context.route("**/*", (route) =>
      SKIPPED_RESOURCES.has(route.request().resourceType()) ? route.abort() : route.continue()
    );
    await ensureLoggedIn(context);

    if (args.hero) for (const courseId of new Set(lessons.map((l) => l.course_kajabi_id))) await captureHero(context, courseId);

    const queue = [...lessons];
    const run = async () => {
      const worker: Worker = { page: null };
      for (let lesson = queue.shift(); lesson; lesson = queue.shift()) {
        const result = await processLesson(context, worker, lesson);
        results.push(result);
        const detail = [result.error, ...result.warnings.map((w) => `warning: ${w}`)].filter(Boolean).join("; ");
        const quizNote = result.quiz ? ` [quiz: ${result.quiz.save}, ${result.quiz.questions === null ? "no questions read" : `${result.quiz.questions} questions read`}]` : "";
        console.log(`${result.outcome.padEnd(14)} ${lesson.kajabi_id} ${lesson.title}${quizNote}${detail ? ` (${detail})` : ""}`);
      }
    };
    await Promise.all(Array.from({ length: Math.min(args.concurrency, lessons.length) }, run));
  } finally {
    await context.close();
  }

  const count = (o: LessonResult["outcome"]) => results.filter((r) => r.outcome === o).length;
  const quizzes = results.filter((r) => r.quiz);
  const quizCount = (o: QuizSaveOutcome) => quizzes.filter((r) => r.quiz!.save === o).length;
  console.log(
    formatContentTotals(args.apply, {
      updated: count("updated"),
      urlsRefreshed: count("urls_refreshed"),
      unchanged: count("unchanged"),
      missing: count("missing"),
      failed: count("failed"),
      quizzes: {
        total: count("quiz"),
        created: quizCount("created"),
        updated: quizCount("updated"),
        unchanged: quizCount("unchanged"),
        noQuestionRead: quizzes.filter((r) => r.quiz!.questions === null).length,
      },
    })
  );
  if (quizzes.length > 0) console.log("Quizzes reach the Hub with the next /api/process/courses run (or the admin Sync from Kajabi).");
  if (count("failed") > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
