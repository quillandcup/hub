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
 * Run step A (/api/import/kajabi-courses) first: this only fills in lessons Bronze already has.
 *
 * Usage:
 *   npm run courses:content -- --course <kajabi-course-id> [--apply] [--env .env.prod]
 *   npm run courses:content -- --course <kajabi-course-id> --skip-drafts
 * Without --apply it captures and reports what it would change, and writes nothing. Re-running is
 * safe: a lesson whose content hasn't changed is skipped. Writes use the service role.
 */

import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
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
import { CONTENT_USAGE, parseContentArgs } from "./kajabi-course-content-args";

const KAJABI_APP = "https://app.kajabi.com";
const LOGIN_WAIT_MS = 10 * 60 * 1000;
const RESPONSE_TIMEOUT_MS = 60_000;
// Nothing the capture needs: skipping them makes each editor load much lighter.
const SKIPPED_RESOURCES = new Set(["image", "media", "font"]);

class SessionExpiredError extends Error {}

const parsed = parseContentArgs(process.argv.slice(2));
if (!parsed.ok) {
  console.error(`${parsed.error}\n\n${CONTENT_USAGE}`);
  process.exit(1);
}
const args = parsed;

const loaded = config({ path: resolve(process.cwd(), args.envFile) });
if (loaded.error) {
  console.error(`Failed to load ${args.envFile}: ${loaded.error.message}`);
  process.exit(1);
}
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error(`${args.envFile} needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.`);
  process.exit(1);
}
const supabase = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

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

async function main() {
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
