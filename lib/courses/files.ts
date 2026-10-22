import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllBronzeRows } from "@/lib/supabase/bronze-pagination";
import { fetchAll, inBatches } from "@/lib/courses/db";
import { visibleLessonIds } from "@/lib/courses/visible";

/**
 * Lesson downloads -> the Hub (docs/COURSES.md, step D, files). The Kajabi content step records each
 * lesson's downloads on Bronze with a presigned link that expires; this copies them into the private
 * `course-files` bucket and records a `course_lesson_files` row, which the lesson page lists and serves
 * through a short-lived signed link after an access check.
 *
 * Files of every lesson are copied, drafts' included (`draft: true`): a file costs nothing to keep, and
 * staff preview draft lessons. A draft's files stay staff-only without any extra rule here: a draft is
 * a hidden Hub lesson, members' row-level security only reads files of open lessons, and the download
 * route (`/courses/[slug]/lessons/[lessonId]/files/[fileId]`) refuses anyone who can't open the lesson.
 * They are copied only once the course is published (a file hangs off a Hub lesson). A file already
 * copied is never copied again; a file Kajabi no longer lists is removed from storage and the table
 * (the lesson's files are re-derived from Bronze, like everything in Silver). Safe to repeat. Needs a
 * service-role client.
 */

export const COURSE_FILES_BUCKET = "course-files";
/** Matches the bucket's own limit. A bigger file is reported, not copied. */
export const MAX_COURSE_FILE_BYTES = 50 * 1024 * 1024;
const LINK_MARGIN_MS = 5 * 60 * 1000;

export type FilePlanState =
  /** Already in the Hub. */
  | "copied"
  /** Has a usable link: will be copied. */
  | "ready_to_copy"
  /** The link has expired: run the Kajabi content step again. */
  | "link_expired"
  | "no_link"
  /** Its lesson isn't in the Hub yet (course not published, or synced since): publish or sync first. */
  | "lesson_not_in_hub";

export interface PlannedFile {
  kajabiFileId: string;
  filename: string;
  lessonTitle: string;
  /** Its lesson isn't visible to members (a Kajabi draft, or under a draft module): staff-only. */
  draft: boolean;
  position: number;
  state: FilePlanState;
  sourceUrl: string | null;
  hubLessonId: string | null;
}

export interface FilePlan {
  files: PlannedFile[];
  /** Hub files whose Kajabi file (or lesson) is gone: to be removed. */
  stale: { id: string; storagePath: string; filename: string }[];
  /** The Hub course, or null when it isn't published (nothing can be copied). */
  courseId: string | null;
}

const EXTENSION_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  txt: "text/plain",
  csv: "text/csv",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  zip: "application/zip",
  mp3: "audio/mpeg",
};

/** A content type for the file: the source's own when it's specific, else by extension. */
export function contentTypeFor(filename: string, reported: string | null | undefined): string {
  const generic = !reported || /^(binary|application)\/octet-stream/i.test(reported);
  if (!generic) return reported.split(";")[0].trim();
  const extension = filename.split(".").pop()?.toLowerCase() ?? "";
  return EXTENSION_TYPES[extension] ?? "application/octet-stream";
}

/** A storage-safe version of a filename (letters, digits, dot, dash, underscore). */
export function safeFilename(filename: string): string {
  return filename.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "") || "file";
}

export function storagePathFor(courseId: string, lessonId: string, kajabiFileId: string, filename: string): string {
  return `${courseId}/${lessonId}/${kajabiFileId}-${safeFilename(filename)}`;
}

/** "148 KB", "2.4 MB". */
export function formatBytes(bytes: number | null | undefined): string | null {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes) || bytes < 0) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export async function planCourseFiles(supabase: SupabaseClient, courseKajabiId: string, now: Date): Promise<FilePlan> {
  const [modules, lessons] = await Promise.all([
    fetchAllBronzeRows(supabase, "kajabi_course_modules", "kajabi_id, parent_kajabi_id, position, title, publishing_option", (q) =>
      q.eq("course_kajabi_id", courseKajabiId).is("deleted_at", null)
    ),
    fetchAllBronzeRows(supabase, "kajabi_course_lessons", "kajabi_id, module_kajabi_id, position, title, publishing_option", (q) =>
      q.eq("course_kajabi_id", courseKajabiId).is("deleted_at", null)
    ),
  ]);
  const visible = visibleLessonIds(modules, lessons);
  const titleById = new Map(lessons.map((l) => [l.kajabi_id, l.title as string]));

  const bronzeFiles: any[] = [];
  for (const batch of inBatches(lessons.map((l) => l.kajabi_id as string))) {
    bronzeFiles.push(
      ...(await fetchAllBronzeRows(supabase, "kajabi_lesson_files", "kajabi_id, lesson_kajabi_id, filename, source_url, raw_payload", (q) =>
        q.in("lesson_kajabi_id", batch).is("deleted_at", null)
      ))
    );
  }

  const { data: course, error } = await supabase.from("courses").select("id").eq("source", "kajabi").eq("source_key", courseKajabiId).maybeSingle();
  if (error) throw new Error(`courses read failed: ${error.message}`);
  const courseId: string | null = course?.id ?? null;

  const hubLessonByKey = new Map<string, string>();
  const existing: any[] = [];
  if (courseId) {
    for (const l of await fetchAll(supabase, "course_lessons", "id, source_key", (q) => q.eq("course_id", courseId).eq("source", "kajabi"))) {
      hubLessonByKey.set(l.source_key, l.id);
    }
    const hubIds = [...hubLessonByKey.values()];
    for (const batch of inBatches(hubIds)) {
      existing.push(...(await fetchAll(supabase, "course_lesson_files", "id, source_key, storage_path, filename", (q) => q.in("lesson_id", batch))));
    }
  }
  const copiedKeys = new Set(existing.map((f) => f.source_key));

  const files: PlannedFile[] = bronzeFiles
    .map((f, index) => {
      const hubLessonId = hubLessonByKey.get(f.lesson_kajabi_id) ?? null;
      const expiresAt = presignedExpiry(f.source_url);
      let state: FilePlanState;
      if (!hubLessonId) state = "lesson_not_in_hub";
      else if (copiedKeys.has(f.kajabi_id)) state = "copied";
      else if (!f.source_url) state = "no_link";
      else if (expiresAt !== null && expiresAt - now.getTime() < LINK_MARGIN_MS) state = "link_expired";
      else state = "ready_to_copy";
      return {
        kajabiFileId: f.kajabi_id as string,
        filename: f.filename as string,
        lessonTitle: titleById.get(f.lesson_kajabi_id) ?? "",
        draft: !visible.has(f.lesson_kajabi_id),
        position: typeof f.raw_payload?.position === "number" ? f.raw_payload.position : index,
        state,
        sourceUrl: (f.source_url as string | null) ?? null,
        hubLessonId,
      };
    })
    .sort((a, b) => a.lessonTitle.localeCompare(b.lessonTitle) || a.position - b.position);

  const liveKeys = new Set(bronzeFiles.map((f) => f.kajabi_id));
  const stale = existing.filter((f) => !liveKeys.has(f.source_key)).map((f) => ({ id: f.id as string, storagePath: f.storage_path as string, filename: f.filename as string }));

  return { files, stale, courseId };
}

/** When an S3 presigned URL stops working, from its X-Amz-Date and X-Amz-Expires; null if it isn't one. */
export function presignedExpiry(url: string | null | undefined): number | null {
  if (!url) return null;
  try {
    const params = new URL(url).searchParams;
    const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(params.get("X-Amz-Date") ?? "");
    const seconds = Number(params.get("X-Amz-Expires"));
    if (!match || !Number.isFinite(seconds)) return null;
    const [, y, mo, d, h, mi, s] = match;
    return Date.UTC(+y, +mo - 1, +d, +h, +mi, +s) + seconds * 1000;
  } catch {
    return null;
  }
}

export interface CopyFilesResult {
  copied: { kajabiFileId: string; filename: string; bytes: number }[];
  alreadyCopied: number;
  removed: number;
  needsNewLink: { kajabiFileId: string; filename: string; reason: "expired" | "missing" }[];
  /** Files whose lesson isn't in the Hub yet. */
  waitingForLesson: number;
  failed: { kajabiFileId: string; filename: string; error: string }[];
}

export async function copyCourseFiles(
  supabase: SupabaseClient,
  courseKajabiId: string,
  now: Date,
  download: typeof fetch = fetch
): Promise<CopyFilesResult> {
  const plan = await planCourseFiles(supabase, courseKajabiId, now);
  const result: CopyFilesResult = { copied: [], alreadyCopied: 0, removed: 0, needsNewLink: [], waitingForLesson: 0, failed: [] };
  const bucket = supabase.storage.from(COURSE_FILES_BUCKET);

  for (const file of plan.files) {
    if (file.state === "copied") result.alreadyCopied++;
    else if (file.state === "lesson_not_in_hub") result.waitingForLesson++;
    else if (file.state === "no_link" || file.state === "link_expired") {
      result.needsNewLink.push({ kajabiFileId: file.kajabiFileId, filename: file.filename, reason: file.state === "link_expired" ? "expired" : "missing" });
    }
  }

  for (const file of plan.files.filter((f) => f.state === "ready_to_copy")) {
    try {
      const response = await download(file.sourceUrl!);
      if (!response.ok) throw new Error(`source answered ${response.status}`);
      const body = Buffer.from(await response.arrayBuffer());
      if (body.byteLength > MAX_COURSE_FILE_BYTES) throw new Error(`larger than ${MAX_COURSE_FILE_BYTES / (1024 * 1024)} MB`);

      const contentType = contentTypeFor(file.filename, response.headers.get("content-type"));
      const path = storagePathFor(plan.courseId!, file.hubLessonId!, file.kajabiFileId, file.filename);
      const { error: uploadError } = await bucket.upload(path, body, { contentType, upsert: true });
      if (uploadError) throw new Error(uploadError.message);

      const { error: rowError } = await supabase.from("course_lesson_files").upsert(
        {
          lesson_id: file.hubLessonId,
          source_key: file.kajabiFileId,
          filename: file.filename,
          content_type: contentType,
          size_bytes: body.byteLength,
          content_hash: createHash("sha256").update(body).digest("hex"),
          storage_path: path,
          position: file.position,
        },
        { onConflict: "source_key" }
      );
      if (rowError) throw new Error(rowError.message);
      result.copied.push({ kajabiFileId: file.kajabiFileId, filename: file.filename, bytes: body.byteLength });
    } catch (error: any) {
      result.failed.push({ kajabiFileId: file.kajabiFileId, filename: file.filename, error: error?.message ?? "copy failed" });
    }
  }

  // Files Kajabi no longer lists (or whose lesson is gone): the row and the stored object go.
  for (const stale of plan.stale) {
    await bucket.remove([stale.storagePath]);
    const { error } = await supabase.from("course_lesson_files").delete().eq("id", stale.id);
    if (error) result.failed.push({ kajabiFileId: stale.id, filename: stale.filename, error: `couldn't remove the row: ${error.message}` });
    else result.removed++;
  }

  return result;
}
