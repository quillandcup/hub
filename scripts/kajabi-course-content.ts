/**
 * Step B of the Kajabi course migration (docs/COURSES.md): captures each lesson's HTML, thumbnail,
 * video source and downloads from Kajabi's admin lesson editor into Bronze.
 *
 * None of that is in Kajabi's public API. The editor loads it as JSON, and that API only answers
 * the editor's own authenticated requests (a plain request with the session cookies gets 401). So
 * this opens a real Chrome window, lets you log in to Kajabi yourself, then opens each lesson's
 * editor and records the two responses it loads. The script never sees or stores a password or a
 * token; the login lives in the browser profile directory.
 *
 * With --hero it also looks for the course's hero banner (the image behind the course title). That is experimental and
 * finds nothing today: the admin product page doesn't carry it; the banner is on the member-facing course page.
 *
 * With --progress it captures every student's per-lesson completion instead (docs/COURSES.md, "Importing Kajabi
 * per-lesson progress"): the Product Progress report page gives the roster, then each student's report is fetched
 * from inside the logged-in page. The roster feeds bronze.kajabi_product_progress, the lessons feed
 * bronze.kajabi_lesson_progress; /api/process/course-progress turns completed lessons into lesson_progress.
 *
 * Run step A (/api/import/kajabi-courses) first: this only fills in lessons Bronze already has.
 *
 * Usage:
 *   npm run courses:content -- --course <kajabi-course-id> [--apply] [--env .env.prod]
 *   npm run courses:content -- --course <kajabi-course-id> --skip-drafts
 *   npm run courses:content -- --course <kajabi-course-id> --progress [--apply]
 * Without --apply it captures and reports what it would change, and writes nothing. Re-running is
 * safe: a lesson whose content hasn't changed is skipped. Writes use the service role.
 */

import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { chromium, type BrowserContext, type Page, type Response } from "playwright";
import {
  parseLessonContent,
  saveLessonContent,
  selectLessons,
  type EditorDownloads,
  type EditorPost,
  type LessonTarget,
  type SaveOutcome,
} from "../lib/kajabi/lesson-content";
import { findCourseHero, imageFieldNames, saveCourseHero } from "../lib/kajabi/course-hero";
import { describeJson, formatProbe, normalizeRequestPath, queryNames, type ProbedRequest } from "../lib/kajabi/probe";
import { ORG_TIMEZONE } from "../lib/config";
import { ProgressSessionExpiredError, runProgressCapture } from "../lib/kajabi/progress-run";
import { describeRosterResponse, forwardableHeaders, rosterHasMembers } from "../lib/kajabi/progress-capture";
import { loadLayeredEnv } from "./load-layered-env";
import { CONTENT_USAGE, parseContentArgs } from "./kajabi-course-content-args";

const KAJABI_APP = "https://app.kajabi.com";
const LOGIN_WAIT_MS = 10 * 60 * 1000;
const RESPONSE_TIMEOUT_MS = 60_000;
// The Product Progress report is built in the background: how long to wait for it, and how often to ask again.
const ROSTER_WAIT_MS = 90_000;
const ROSTER_REASK_MS = 4_000;
// Nothing the capture needs: skipping them makes each editor load much lighter.
const SKIPPED_RESOURCES = new Set(["image", "media", "font"]);

class SessionExpiredError extends Error {}

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

/** Moves the open page to the lesson's editor through the app's router and records its JSON. */
async function capture(page: Page, lessonId: string): Promise<{ post: EditorPost; downloads: EditorDownloads }> {
  const wait = (suffix: string) =>
    page.waitForResponse((r) => r.request().method() === "GET" && pathOf(r) === `/api/admin/posts/${lessonId}${suffix}`, {
      timeout: RESPONSE_TIMEOUT_MS,
    });
  const postResponse = wait("");
  const downloadsResponse = wait("/downloads");
  // A response that never arrives would otherwise be an unhandled rejection.
  postResponse.catch(() => undefined);
  downloadsResponse.catch(() => undefined);

  await page.evaluate((id) => {
    history.pushState({}, "", `/admin/posts/${id}/edit`);
    window.dispatchEvent(new PopStateEvent("popstate", { state: {} }));
  }, lessonId);
  const [post, downloads] = await Promise.all([postResponse, downloadsResponse]);

  for (const r of [post, downloads]) {
    if (r.status() === 401) throw new SessionExpiredError("Kajabi answered 401: the login expired. Run again and log in.");
    if (r.status() === 404) throw new Error("Kajabi has no such lesson (404)");
    if (!r.ok()) throw new Error(`Kajabi answered ${r.status()}`);
  }
  return { post: (await post.json()) as EditorPost, downloads: (await downloads.json()) as EditorDownloads };
}

interface LessonResult {
  lesson: LessonTarget;
  outcome: SaveOutcome | "failed";
  error?: string;
  warnings: string[];
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
      return { lesson, outcome, warnings };
    } catch (error) {
      if (error instanceof SessionExpiredError) throw error;
      lastError = error;
      await worker.page?.close().catch(() => undefined);
      worker.page = null;
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
  try {
    await context.route("**/*", (route) => (SKIPPED_RESOURCES.has(route.request().resourceType()) ? route.abort() : route.continue()));
    await ensureLoggedIn(context);
    const page = await context.newPage();
    page.on("response", (r) => {
      if (!(r.headers()["content-type"] ?? "").includes("json")) return;
      pending.push(
        (async () => {
          const json = await r.json().catch(() => undefined);
          seen.push({
            method: r.request().method(),
            status: r.status(),
            path: normalizeRequestPath(r.url()),
            query: queryNames(r.url()),
            fields: json === undefined ? [] : describeJson(json),
          });
        })()
      );
    });
    await page.goto(target.url, { waitUntil: "domcontentloaded" });
    console.log(`Recording for ${target.seconds} seconds. Click around in the browser window (open a week, a module, the next page) so its requests are seen.`);
    await page.waitForTimeout(target.seconds * 1000);
    await Promise.all(pending);
  } finally {
    await context.close();
  }
  console.log(`\n${formatProbe(seen)}\n\nPage: ${normalizeRequestPath(target.url)}. Names and types only, no values.`);
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

    const { roster: r, lessons: l } = summary;
    console.log(
      `\n${args.apply ? "Done" : "Dry run, nothing written"}: ${summary.members} students in the roster ` +
        `(${r.written} written, ${r.unchanged} unchanged, ${r.removed} removed; ${summary.rosterSkipped} unusable, ${summary.duplicateEmails} duplicate emails)\n` +
        `lessons: ${summary.membersCaptured} students captured, ${summary.lessonsListed} lessons listed, ${summary.lessonsCompleted} completed; ` +
        `${l.written} rows written, ${l.unchanged} unchanged, ${l.removed} removed; ` +
        `${summary.membersWithoutLessons} students with no lessons, ${summary.membersFailed} failed, ${summary.lessonsNotInBronze} lessons not in Bronze`
    );
    if (summary.membersFailed > 0) process.exitCode = 1;
  } finally {
    await context.close();
  }
}

async function main() {
  if (args.probe) return probe(args.probe);
  if (args.progress) {
    if (!args.scope || !("courseId" in args.scope)) throw new Error("--progress needs --course");
    return captureProgress(args.scope.courseId);
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
        console.log(`${result.outcome.padEnd(14)} ${lesson.kajabi_id} ${lesson.title}${detail ? ` (${detail})` : ""}`);
      }
    };
    await Promise.all(Array.from({ length: Math.min(args.concurrency, lessons.length) }, run));
  } finally {
    await context.close();
  }

  const count = (o: LessonResult["outcome"]) => results.filter((r) => r.outcome === o).length;
  console.log(
    `\n${args.apply ? "Done" : "Dry run, nothing written"}: ${count("updated")} updated, ${count("urls_refreshed")} links refreshed, ` +
      `${count("unchanged")} unchanged, ${count("missing")} not in Bronze, ${count("failed")} failed`
  );
  if (count("failed") > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
