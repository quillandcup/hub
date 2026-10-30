/**
 * The `courses:content --progress` run, apart from the browser (docs/COURSES.md, "Importing Kajabi
 * per-lesson progress"): given the roster response and a way to fetch one student's report, it saves the roster
 * to `bronze.kajabi_product_progress` and each student's lessons to `bronze.kajabi_lesson_progress`.
 *
 * Nothing here prints or returns a name or an email: the summary is counts only. A student whose report could not
 * be read completely writes nothing, so a failed fetch can never soft-delete their lessons.
 *
 * Relative imports only: the script that calls this runs outside Next.
 */

import type { Db } from "../data/db";
import { saveProductProgress } from "../courses/product-progress-store";
import { SupabaseKajabiCourseRepository } from "../data/kajabi-courses";
import { saveMemberLessonProgress } from "./lesson-progress";
import { memberReportUrl, parseMemberProgress, parseRoster, type RosterEntry } from "./progress-capture";

/** The Kajabi login is no longer valid: stop the run and log in again. */
export class ProgressSessionExpiredError extends Error {}

export interface ProgressRunOptions {
  db: Db;
  courseKajabiId: string;
  /** The roster response's JSON and the URL it came from (the member reports reuse its origin, path and query). */
  roster: { url: string; json: unknown };
  /** One request for a student's report, made inside the logged-in page. Resolves with the status; never throws for HTTP errors. */
  fetchReport: (url: string) => Promise<{ status: number; json?: unknown }>;
  /** Said after a 401, so a refusal explains itself (for example which headers were sent, by name). */
  refusalHint?: string;
  apply: boolean;
  timeZone: string;
  concurrency?: number;
  delayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
  log?: (line: string) => void;
}

export interface ProgressSummary {
  /** Students in the roster, after leaving out unusable and duplicate entries. */
  members: number;
  rosterSkipped: number;
  duplicateEmails: number;
  /** Kajabi's own count differs from the entries it sent (a paged or filtered roster). */
  rosterCountMismatch: boolean;
  roster: { written: number; unchanged: number; removed: number };
  membersCaptured: number;
  membersFailed: number;
  /** Students whose report listed no lessons at all: left untouched rather than emptied. */
  membersWithoutLessons: number;
  lessonsListed: number;
  lessonsCompleted: number;
  /** Lessons in the reports that Bronze (step A) has no lesson for. */
  lessonsNotInBronze: number;
  lessons: { written: number; unchanged: number; removed: number };
}

/** The path of a member-report URL with the student's id masked, for error messages. */
const describePath = (url: string) => new URL(url).pathname.replace(/\/members\/[^/]+/, "/members/:id");

export async function loadKnownLessonIds(db: Db, courseKajabiId: string): Promise<Set<string>> {
  const ids = await new SupabaseKajabiCourseRepository(db).liveLessonIds(courseKajabiId);
  return new Set(ids);
}

export async function runProgressCapture(options: ProgressRunOptions): Promise<ProgressSummary> {
  const { db, courseKajabiId, roster, apply, timeZone } = options;
  const log = options.log ?? (() => undefined);
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = options.now ?? (() => new Date());
  const delayMs = options.delayMs ?? 400;

  const parsed = parseRoster(roster.json, timeZone);
  const seen = new Set<string>();
  const entries: RosterEntry[] = [];
  let duplicateEmails = 0;
  for (const e of parsed.entries) {
    if (seen.has(e.email)) {
      duplicateEmails++;
      continue;
    }
    seen.add(e.email);
    entries.push(e);
  }
  const rosterCountMismatch = parsed.count !== null && parsed.count !== parsed.entries.length + parsed.skipped;
  if (rosterCountMismatch) {
    log(`Warning: Kajabi's roster says ${parsed.count} students but sent ${parsed.entries.length + parsed.skipped}. It may be paged or filtered, so students it does not list are not removed.`);
  }
  // Only a roster known to be whole may soft-delete students it no longer lists.
  const rosterComplete = !rosterCountMismatch && parsed.count !== null && parsed.skipped === 0;

  const rosterSaved = await saveProductProgress(db, {
    courseKajabiId,
    rows: entries.map((e) => ({ email: e.email, percent: e.percent, logins: e.logins, startedOn: e.startedOn, lastActivityOn: e.lastActivityOn })),
    sourceFile: "kajabi-admin-capture",
    dryRun: !apply,
    removeMissing: rosterComplete,
  });

  const known = await loadKnownLessonIds(db, courseKajabiId);
  const summary: ProgressSummary = {
    members: entries.length,
    rosterSkipped: parsed.skipped,
    duplicateEmails,
    rosterCountMismatch,
    roster: { written: rosterSaved.written, unchanged: rosterSaved.unchanged, removed: rosterSaved.removed },
    membersCaptured: 0,
    membersFailed: 0,
    membersWithoutLessons: 0,
    lessonsListed: 0,
    lessonsCompleted: 0,
    lessonsNotInBronze: 0,
    lessons: { written: 0, unchanged: 0, removed: 0 },
  };
  const unknownLessons = new Set<string>();
  const failureKinds = new Map<string, number>();
  const fail = (reason: string) => {
    summary.membersFailed++;
    failureKinds.set(reason, (failureKinds.get(reason) ?? 0) + 1);
  };

  async function readReport(entry: RosterEntry) {
    const url = memberReportUrl(roster.url, entry.memberId);
    let lastReason = "";
    for (let attempt = 1; attempt <= 2; attempt++) {
      let response: { status: number; json?: unknown };
      try {
        response = await options.fetchReport(url);
      } catch (error) {
        lastReason = `the request failed (${error instanceof Error ? error.message : "unknown error"}) for ${describePath(url)}`;
        await sleep(delayMs * 2);
        continue;
      }
      if (response.status === 401) {
        throw new ProgressSessionExpiredError(
          `Kajabi answered 401 for ${describePath(url)}. If the browser window is logged in, Kajabi wants something its own requests send, not a new login.${options.refusalHint ? ` ${options.refusalHint}` : " Run again and log in if the window is not."}`
        );
      }
      if (response.status < 200 || response.status >= 300) {
        lastReason = `Kajabi answered ${response.status} for ${describePath(url)}`;
        await sleep(delayMs * 2);
        continue;
      }
      return { ok: true as const, json: response.json };
    }
    return { ok: false as const, reason: lastReason };
  }

  const queue = [...entries];
  let done = 0;
  let stopped = false;
  const worker = async () => {
    for (let entry = queue.shift(); entry && !stopped; entry = queue.shift()) {
      let report: Awaited<ReturnType<typeof readReport>>;
      try {
        report = await readReport(entry);
      } catch (error) {
        stopped = true;
        throw error;
      }
      if (!report.ok) {
        fail(report.reason);
      } else {
        const progress = parseMemberProgress(report.json, timeZone);
        if (progress.memberId !== null && progress.memberId !== entry.memberId) {
          fail("a report was for a different student than asked for");
        } else if (progress.lessons.length === 0) {
          summary.membersWithoutLessons++;
        } else {
          try {
            const saved = await saveMemberLessonProgress(
              db,
              { courseKajabiId, email: entry.email, contactId: progress.contactId ?? entry.contactId, memberId: entry.memberId, lessons: progress.lessons, capturedAt: now() },
              { dryRun: !apply },
            );
            summary.membersCaptured++;
            summary.lessonsListed += progress.lessons.length;
            summary.lessonsCompleted += progress.lessons.filter((l) => l.completed).length;
            summary.lessons.written += saved.written;
            summary.lessons.unchanged += saved.unchanged;
            summary.lessons.removed += saved.removed;
            for (const l of progress.lessons) if (!known.has(l.kajabiLessonId)) unknownLessons.add(l.kajabiLessonId);
          } catch (error) {
            fail(`saving failed (${error instanceof Error ? error.message : "unknown error"})`);
          }
        }
      }
      done++;
      if (done % 25 === 0) log(`${done} of ${entries.length} students`);
      await sleep(delayMs);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(options.concurrency ?? 2, entries.length || 1)) }, worker));

  summary.lessonsNotInBronze = unknownLessons.size;
  for (const [reason, count] of failureKinds) log(`${count} student(s) skipped: ${reason}`);
  return summary;
}
