import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAll } from "@/lib/courses/db";
import { safeUrl } from "@/lib/url";

/**
 * Course images -> the Hub (docs/COURSES.md, step D, images). Kajabi gives each course a cover
 * (`courses.thumbnail_url`), each module a poster (`course_modules.poster_url`) and each lesson a
 * thumbnail (`course_lessons.thumbnail_url`). Those were hotlinked from Kajabi, so they would break when
 * the Kajabi site goes. This copies each into the private `course-images` bucket and records where our
 * copy lives (`*_path`) and the Kajabi URL, minus its query string, it was copied from (`*_source`).
 *
 * Idempotent: an image whose source URL hasn't changed is skipped. An image Kajabi no longer has is
 * removed from storage and its columns cleared; objects whose lesson or module is gone are swept. The
 * pages use our copy when there is one (`courseImageSrc`) and the Kajabi URL until the copy has run.
 * Needs a service-role client.
 */

export const COURSE_IMAGES_BUCKET = "course-images";
/** Matches the bucket's own limit. A bigger image is reported, not copied. */
export const MAX_COURSE_IMAGE_BYTES = 10 * 1024 * 1024;
const CONCURRENCY = 5;

export type CourseImageKind = "course" | "module" | "lesson";

const TABLES = {
  course: { table: "courses", urlColumn: "thumbnail_url", pathColumn: "thumbnail_path", sourceColumn: "thumbnail_source", folder: "" },
  module: { table: "course_modules", urlColumn: "poster_url", pathColumn: "poster_path", sourceColumn: "poster_source", folder: "modules" },
  lesson: { table: "course_lessons", urlColumn: "thumbnail_url", pathColumn: "thumbnail_path", sourceColumn: "thumbnail_source", folder: "lessons" },
} as const;

export function imageTable(kind: CourseImageKind) {
  return TABLES[kind];
}

/** The URL a page puts in an `<img>`: our copy when it exists, the Kajabi URL until then. */
export function courseImageSrc(kind: CourseImageKind, id: string, path: string | null | undefined, fallbackUrl: string | null | undefined): string | null {
  if (path) return `/api/courses/image/${kind}/${id}`;
  return safeUrl(fallbackUrl);
}

/** For an `<img src>`: one of our own image paths, or an http(s) URL; anything else is dropped. */
export function courseImageUrl(url: string | null | undefined): string | null {
  return url?.startsWith("/api/courses/image/") ? url : safeUrl(url);
}

const EXTENSIONS: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/gif": "gif", "image/webp": "webp", "image/avif": "avif" };

function withoutQuery(url: string): string {
  return url.split("?")[0];
}

export interface CopyImagesResult {
  copied: number;
  alreadyCopied: number;
  removed: number;
  failed: { kind: CourseImageKind; id: string; error: string }[];
}

interface Item {
  kind: CourseImageKind;
  id: string;
  url: string | null;
  path: string | null;
  source: string | null;
}

export async function copyCourseImages(supabase: SupabaseClient, courseKajabiId: string, download: typeof fetch = fetch): Promise<CopyImagesResult> {
  const result: CopyImagesResult = { copied: 0, alreadyCopied: 0, removed: 0, failed: [] };
  const { data: course, error } = await supabase.from("courses").select("id").eq("source", "kajabi").eq("source_key", courseKajabiId).maybeSingle();
  if (error) throw new Error(`courses read failed: ${error.message}`);
  if (!course) return result; // not published yet: nothing to attach images to
  const courseId: string = course.id;
  const bucket = supabase.storage.from(COURSE_IMAGES_BUCKET);

  const items: Item[] = [];
  for (const kind of ["course", "module", "lesson"] as const) {
    const t = TABLES[kind];
    const rows = await fetchAll(supabase, t.table, `id, ${t.urlColumn}, ${t.pathColumn}, ${t.sourceColumn}`, (q) =>
      (kind === "course" ? q.eq("id", courseId) : q.eq("course_id", courseId)).order("id")
    );
    for (const r of rows) items.push({ kind, id: r.id, url: r[t.urlColumn] ?? null, path: r[t.pathColumn] ?? null, source: r[t.sourceColumn] ?? null });
  }

  const handle = async (item: Item) => {
    const t = TABLES[item.kind];
    const url = safeUrl(item.url);
    const save = async (patch: Record<string, string | null>) => {
      const { error: updateError } = await supabase.from(t.table).update(patch).eq("id", item.id);
      if (updateError) throw new Error(updateError.message);
    };
    try {
      if (!url) {
        if (!item.path) return;
        await bucket.remove([item.path]);
        await save({ [t.pathColumn]: null, [t.sourceColumn]: null });
        result.removed++;
        return;
      }
      if (item.path && item.source === withoutQuery(url)) {
        result.alreadyCopied++;
        return;
      }
      const response = await download(url);
      if (!response.ok) throw new Error(`source answered ${response.status}`);
      const contentType = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
      const extension = EXTENSIONS[contentType];
      if (!extension) throw new Error(`not an image we can store (${contentType || "no content type"})`);
      const body = Buffer.from(await response.arrayBuffer());
      if (body.byteLength > MAX_COURSE_IMAGE_BYTES) throw new Error(`larger than ${MAX_COURSE_IMAGE_BYTES / (1024 * 1024)} MB`);

      const path = [courseId, t.folder, `${item.kind === "course" ? "cover" : item.id}.${extension}`].filter(Boolean).join("/");
      const { error: uploadError } = await bucket.upload(path, body, { contentType, upsert: true });
      if (uploadError) throw new Error(uploadError.message);
      await save({ [t.pathColumn]: path, [t.sourceColumn]: withoutQuery(url) });
      if (item.path && item.path !== path) await bucket.remove([item.path]); // the format changed
      result.copied++;
    } catch (e: any) {
      result.failed.push({ kind: item.kind, id: item.id, error: e?.message ?? "copy failed" });
    }
  };
  for (let i = 0; i < items.length; i += CONCURRENCY) await Promise.all(items.slice(i, i + CONCURRENCY).map(handle));

  // Objects whose lesson or module is gone (or whose path was replaced): sweep what no row points at.
  const referenced = new Set<string>();
  for (const kind of ["course", "module", "lesson"] as const) {
    const t = TABLES[kind];
    const rows = await fetchAll(supabase, t.table, `id, ${t.pathColumn}`, (q) => (kind === "course" ? q.eq("id", courseId) : q.eq("course_id", courseId)).order("id"));
    for (const r of rows) if (r[t.pathColumn]) referenced.add(r[t.pathColumn]);
  }
  for (const folder of ["", "modules", "lessons"]) {
    const prefix = folder ? `${courseId}/${folder}` : courseId;
    const orphans: string[] = [];
    for (let offset = 0; ; offset += 1000) {
      const { data, error: listError } = await bucket.list(prefix, { limit: 1000, offset });
      if (listError) throw new Error(`course-images list failed: ${listError.message}`);
      for (const object of data ?? []) {
        if (object.id === null) continue; // a folder
        const path = `${prefix}/${object.name}`;
        if (!referenced.has(path)) orphans.push(path);
      }
      if (!data || data.length < 1000) break;
    }
    if (orphans.length > 0) {
      await bucket.remove(orphans);
      result.removed += orphans.length;
    }
  }
  return result;
}
