import type { SupabaseClient } from "@supabase/supabase-js";
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
 * library image removed once nothing shows it. Pages use the library image when there is one and the Kajabi URL until
 * the copy has run. Needs a service-role client.
 */

/** A bigger image than this is reported, not copied. */
export const MAX_COURSE_IMAGE_BYTES = 10 * 1024 * 1024;
const CONCURRENCY = 5;
const SEARCH_PAGE = 200;

export type { CourseImageKind };

const SOURCE_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp", "image/avif"]);

function withoutQuery(url: string): string {
  return url.split("?")[0];
}

export interface CopyImagesResult {
  /** Fetched from Kajabi into the library. */
  copied: number;
  alreadyCopied: number;
  removed: number;
  failed: { kind: CourseImageKind; id: string; error: string }[];
}

interface Item {
  kind: CourseImageKind;
  id: string;
  title: string;
  url: string | null;
  asset: string | null;
  source: string | null;
}

/** Removes a library image once nothing shows it (a lesson and its module can share one). */
async function releaseUnused(media: MediaRepository, assetId: string | null): Promise<void> {
  if (!assetId) return;
  if ((await media.usages(assetId)).length === 0) await media.remove(assetId);
}

export async function copyCourseImages(supabase: SupabaseClient, courseKajabiId: string, download: typeof fetch = fetch): Promise<CopyImagesResult> {
  const result: CopyImagesResult = { copied: 0, alreadyCopied: 0, removed: 0, failed: [] };
  const repos = createRepos(supabase);
  const course = await repos.courses.courseBySource("kajabi", courseKajabiId);
  if (!course) return result; // not published yet: nothing to attach images to
  const courseId: string = course.id;
  const tags = ["kajabi", course.slug as string];
  const media = repos.media;

  const [modules, lessons] = await Promise.all([repos.courses.modulesOf([courseId], { includeHidden: true }), repos.courses.lessonsOf([courseId], { includeHidden: true })]);
  const items: Item[] = [
    { kind: "course", id: course.id, title: course.title ?? "Course image", url: course.thumbnail_url, asset: course.thumbnail_asset_id, source: course.thumbnail_source },
    { kind: "hero", id: course.id, title: course.title ?? "Course image", url: course.hero_url, asset: course.hero_asset_id, source: course.hero_source },
    ...modules.map((m): Item => ({ kind: "module", id: m.id, title: m.title ?? "Course image", url: m.poster_url, asset: m.poster_asset_id, source: m.poster_source })),
    ...lessons.map((l): Item => ({ kind: "lesson", id: l.id, title: l.title ?? "Course image", url: l.thumbnail_url, asset: l.thumbnail_asset_id, source: l.thumbnail_source })),
  ];

  const handle = async (item: Item) => {
    const url = safeUrl(item.url);
    const save = (image: { asset: string | null; source: string | null }) => repos.courses.setImage(item.kind, item.id, image);
    try {
      if (!url) {
        if (!item.asset) return;
        await save({ asset: null, source: null });
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
      if (!asset) {
        const response = await download(url);
        if (!response.ok) throw new Error(`source answered ${response.status}`);
        const contentType = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
        if (!SOURCE_TYPES.has(contentType)) throw new Error(`not an image we can store (${contentType || "no content type"})`);
        const body = Buffer.from(await response.arrayBuffer());
        if (body.byteLength > MAX_COURSE_IMAGE_BYTES) throw new Error(`larger than ${MAX_COURSE_IMAGE_BYTES / (1024 * 1024)} MB`);
        const stored = await storeImage(media, supabase.storage, { bytes: body, title: item.title, tags, source: "kajabi", sourceKey: source });
        if (!stored.ok) throw new Error(stored.error);
        asset = stored.asset;
      }

      await save({ asset: asset.id, source });
      if (item.asset && item.asset !== asset.id) await releaseUnused(media, item.asset); // the source image changed
      result.copied++;
    } catch (e: any) {
      result.failed.push({ kind: item.kind, id: item.id, error: e?.message ?? "copy failed" });
    }
  };
  for (let i = 0; i < items.length; i += CONCURRENCY) await Promise.all(items.slice(i, i + CONCURRENCY).map(handle));

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
