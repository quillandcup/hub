import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAll } from "@/lib/courses/db";
import type { MediaRepository } from "@/lib/data/media";
import { createRepos } from "@/lib/data/repos";
import { storeImage } from "@/lib/media/library";
import { safeUrl } from "@/lib/url";
import type { CourseImageKind } from "./image-urls";

/**
 * Course images -> the media library (docs/COURSES.md, step D, images; docs/MEDIA_LIBRARY.md). Kajabi gives each
 * course a cover (`courses.thumbnail_url`) and a banner (`hero_url`), each module a poster (`course_modules.poster_url`)
 * and each lesson a thumbnail (`course_lessons.thumbnail_url`). Those were hotlinked from Kajabi, so they would break
 * when the Kajabi site goes. This stores each as a library image (shared, tagged `kajabi` and the course's slug, with
 * the Kajabi link it came from as its source) and records the asset (`*_asset_id`) and the link, minus its query
 * string, it was copied from (`*_source`).
 *
 * Idempotent: an image whose source link hasn't changed is skipped. An image Kajabi no longer has is cleared, and its
 * library image removed once nothing shows it. Images that an earlier version of this step copied into the private
 * `course-images` bucket (`*_path`) are moved into the library from there, without asking Kajabi again; the bucket
 * and those columns go once every course has been through this. Pages use the library image when there is one and the
 * Kajabi URL until the copy has run. Needs a service-role client.
 */

/** The old private bucket (see above); its objects are moved into the library, then removed. */
export const COURSE_IMAGES_BUCKET = "course-images";
/** A bigger image than this is reported, not copied. */
export const MAX_COURSE_IMAGE_BYTES = 10 * 1024 * 1024;
const CONCURRENCY = 5;
const SEARCH_PAGE = 200;

const TABLES = {
  course: { table: "courses", urlColumn: "thumbnail_url", pathColumn: "thumbnail_path", assetColumn: "thumbnail_asset_id", sourceColumn: "thumbnail_source", folder: "" },
  hero: { table: "courses", urlColumn: "hero_url", pathColumn: "hero_path", assetColumn: "hero_asset_id", sourceColumn: "hero_source", folder: "" },
  module: { table: "course_modules", urlColumn: "poster_url", pathColumn: "poster_path", assetColumn: "poster_asset_id", sourceColumn: "poster_source", folder: "modules" },
  lesson: { table: "course_lessons", urlColumn: "thumbnail_url", pathColumn: "thumbnail_path", assetColumn: "thumbnail_asset_id", sourceColumn: "thumbnail_source", folder: "lessons" },
} as const;

export type { CourseImageKind };

export function imageTable(kind: CourseImageKind) {
  return TABLES[kind];
}

const SOURCE_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp", "image/avif"]);

function withoutQuery(url: string): string {
  return url.split("?")[0];
}

export interface CopyImagesResult {
  /** Fetched from Kajabi into the library. */
  copied: number;
  /** Moved into the library from the old private bucket, without asking Kajabi. */
  moved: number;
  alreadyCopied: number;
  removed: number;
  failed: { kind: CourseImageKind; id: string; error: string }[];
}

interface Item {
  kind: CourseImageKind;
  id: string;
  title: string;
  url: string | null;
  path: string | null;
  asset: string | null;
  source: string | null;
}

/** Removes a library image once nothing shows it (a lesson and its module can share one). */
async function releaseUnused(media: MediaRepository, assetId: string | null): Promise<void> {
  if (!assetId) return;
  if ((await media.usages(assetId)).length === 0) await media.remove(assetId);
}

export async function copyCourseImages(supabase: SupabaseClient, courseKajabiId: string, download: typeof fetch = fetch): Promise<CopyImagesResult> {
  const result: CopyImagesResult = { copied: 0, moved: 0, alreadyCopied: 0, removed: 0, failed: [] };
  const { data: course, error } = await supabase.from("courses").select("id, slug").eq("source", "kajabi").eq("source_key", courseKajabiId).maybeSingle();
  if (error) throw new Error(`courses read failed: ${error.message}`);
  if (!course) return result; // not published yet: nothing to attach images to
  const courseId: string = course.id;
  const tags = ["kajabi", course.slug as string];
  const media = createRepos(supabase).media;
  const legacy = supabase.storage.from(COURSE_IMAGES_BUCKET);

  const items: Item[] = [];
  for (const kind of ["course", "hero", "module", "lesson"] as const) {
    const t = TABLES[kind];
    const rows = await fetchAll(supabase, t.table, `id, title, ${t.urlColumn}, ${t.pathColumn}, ${t.assetColumn}, ${t.sourceColumn}`, (q) =>
      (kind === "course" || kind === "hero" ? q.eq("id", courseId) : q.eq("course_id", courseId)).order("id")
    );
    for (const r of rows) {
      items.push({ kind, id: r.id, title: r.title ?? "Course image", url: r[t.urlColumn] ?? null, path: r[t.pathColumn] ?? null, asset: r[t.assetColumn] ?? null, source: r[t.sourceColumn] ?? null });
    }
  }

  const handle = async (item: Item) => {
    const t = TABLES[item.kind];
    const url = safeUrl(item.url);
    const save = async (patch: Record<string, string | null>) => {
      const { error: updateError } = await supabase.from(t.table).update(patch).eq("id", item.id);
      if (updateError) throw new Error(updateError.message);
    };
    const store = async (bytes: Buffer, source: string) => {
      const stored = await storeImage(media, supabase.storage, { bytes, title: item.title, tags, source: "kajabi", sourceKey: source });
      if (!stored.ok) throw new Error(stored.error);
      return stored.asset;
    };
    try {
      if (!url) {
        if (!item.path && !item.asset) return;
        await save({ [t.pathColumn]: null, [t.assetColumn]: null, [t.sourceColumn]: null });
        if (item.path) await legacy.remove([item.path]);
        await releaseUnused(media, item.asset);
        result.removed++;
        return;
      }
      const source = withoutQuery(url);
      if (item.asset && item.source === source) {
        result.alreadyCopied++;
        return;
      }

      // The library may already hold this link's image (a lesson and its module can share one): no fetch.
      let asset = await media.bySource("kajabi", source);
      let moved = false;
      if (!asset && item.path && item.source === source) {
        // Our own earlier copy of exactly this image: move it over, no round trip to Kajabi.
        const old = await legacy.download(item.path);
        if (!old.error && old.data) {
          asset = await store(Buffer.from(await old.data.arrayBuffer()), source);
          moved = true;
        }
      }
      if (!asset) {
        const response = await download(url);
        if (!response.ok) throw new Error(`source answered ${response.status}`);
        const contentType = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
        if (!SOURCE_TYPES.has(contentType)) throw new Error(`not an image we can store (${contentType || "no content type"})`);
        const body = Buffer.from(await response.arrayBuffer());
        if (body.byteLength > MAX_COURSE_IMAGE_BYTES) throw new Error(`larger than ${MAX_COURSE_IMAGE_BYTES / (1024 * 1024)} MB`);
        asset = await store(body, source);
      }

      await save({ [t.assetColumn]: asset.id, [t.sourceColumn]: source, [t.pathColumn]: null });
      if (item.path) await legacy.remove([item.path]); // the old copy: it is in the library now
      if (item.asset && item.asset !== asset.id) await releaseUnused(media, item.asset); // the source image changed
      if (moved) result.moved++;
      else result.copied++;
    } catch (e: any) {
      result.failed.push({ kind: item.kind, id: item.id, error: e?.message ?? "copy failed" });
    }
  };
  for (let i = 0; i < items.length; i += CONCURRENCY) await Promise.all(items.slice(i, i + CONCURRENCY).map(handle));

  // Leftovers in the old bucket: objects whose lesson or module is gone (or whose path was replaced).
  const referenced = new Set<string>();
  for (const kind of ["course", "hero", "module", "lesson"] as const) {
    const t = TABLES[kind];
    const rows = await fetchAll(supabase, t.table, `id, ${t.pathColumn}`, (q) => (kind === "course" || kind === "hero" ? q.eq("id", courseId) : q.eq("course_id", courseId)).order("id"));
    for (const r of rows) if (r[t.pathColumn]) referenced.add(r[t.pathColumn]);
  }
  for (const folder of ["", "modules", "lessons"]) {
    const prefix = folder ? `${courseId}/${folder}` : courseId;
    const orphans: string[] = [];
    for (let offset = 0; ; offset += 1000) {
      const { data, error: listError } = await legacy.list(prefix, { limit: 1000, offset });
      if (listError) throw new Error(`course-images list failed: ${listError.message}`);
      for (const object of data ?? []) {
        if (object.id === null) continue; // a folder
        const path = `${prefix}/${object.name}`;
        if (!referenced.has(path)) orphans.push(path);
      }
      if (!data || data.length < 1000) break;
    }
    if (orphans.length > 0) {
      await legacy.remove(orphans);
      result.removed += orphans.length;
    }
  }

  // Leftovers in the library: this course's Kajabi images that no course, module or lesson shows any more.
  // (Collected first, then removed: removing while paging would shift the pages.)
  const candidates: string[] = [];
  for (let offset = 0; ; offset += SEARCH_PAGE) {
    const page = await media.search({ scope: "shared", tag: course.slug as string, limit: SEARCH_PAGE, offset });
    candidates.push(...page.filter((a) => a.source === "kajabi").map((a) => a.id));
    if (page.length < SEARCH_PAGE) break;
  }
  for (const assetId of candidates) {
    if ((await media.usages(assetId)).length === 0 && (await media.remove(assetId))) result.removed++;
  }
  return result;
}
