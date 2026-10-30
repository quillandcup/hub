/**
 * A course's hero image (docs/COURSES.md, step D, images): the banner behind the course title. It is not the
 * thumbnail and neither Kajabi's public API nor the admin product page carries it (the banner is a background
 * image on the member-facing course page; see docs/TODO.md, "Course Hero Image"), so nothing calls this by
 * default. `scripts/kajabi-course-content.ts --hero` is an experimental caller that searches the JSON the admin
 * product page loads. `findCourseHero` looks for an image URL under a key that says hero, banner, cover or
 * background (never the thumbnail); `saveCourseHero` records it on the Bronze course row (`hero_image_url`, a
 * column the API import never writes); processing copies it to Silver and the course-images copy step stores
 * our own copy. Re-running with the same URL writes nothing.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Db } from "../data/db";
import { SupabaseKajabiCourseRepository } from "../data/kajabi-courses";

const HERO_KEY = /hero|banner|cover|background/i;
const THUMBNAIL_KEY = /thumb|poster/i;
const IS_URL = /^https?:\/\//i;

export interface CourseHero {
  url: string;
  /** Where in the JSON it was found, e.g. `data.attributes.heroImageUrl`. */
  key: string;
}

/** Every string at an http(s) URL in the JSON, with its path. Depth-limited, so a odd payload can't run away. */
function urlFields(node: unknown, path: string, out: { key: string; url: string }[], depth = 0): void {
  if (depth > 8 || node === null || node === undefined) return;
  if (typeof node === "string") {
    if (IS_URL.test(node)) out.push({ key: path, url: node });
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((item, i) => urlFields(item, `${path}[${i}]`, out, depth + 1));
    return;
  }
  if (typeof node === "object") {
    for (const [k, v] of Object.entries(node)) urlFields(v, path ? `${path}.${k}` : k, out, depth + 1);
  }
}

/** The product's hero image: the first URL under a hero-ish key that isn't a thumbnail. Null when there is none. */
export function findCourseHero(product: unknown): CourseHero | null {
  const fields: { key: string; url: string }[] = [];
  urlFields((product as { data?: unknown })?.data ?? product, "data", fields);
  const last = (key: string) => key.split(".").pop() ?? key;
  const found = fields.find((f) => HERO_KEY.test(last(f.key)) && !THUMBNAIL_KEY.test(last(f.key)));
  return found ? { url: found.url, key: found.key } : null;
}

/** The names (never the values) of the URL-valued fields, for the line the script prints when no hero was found. */
export function imageFieldNames(product: unknown): string[] {
  const fields: { key: string; url: string }[] = [];
  urlFields((product as { data?: unknown })?.data ?? product, "data", fields);
  return [...new Set(fields.map((f) => f.key.replace(/\[\d+\]/g, "[]")))].sort();
}

export type HeroOutcome = "updated" | "unchanged" | "missing";

/**
 * Records a course's hero on its Bronze row. "missing" when Step A hasn't imported the course. An unchanged
 * URL writes nothing; a changed one (including a refreshed signed link) is written. Never clears an
 * existing hero: no hero found is the caller's warning, not a deletion.
 */
export async function saveCourseHero(
  supabase: SupabaseClient,
  courseKajabiId: string,
  url: string,
  now: Date,
  options: { dryRun?: boolean } = {}
): Promise<HeroOutcome> {
  const repo = new SupabaseKajabiCourseRepository(supabase as Db);
  const course = await repo.liveCourse(courseKajabiId);
  if (!course) return "missing";
  if (course.hero_image_url === url) return "unchanged";
  if (!options.dryRun) await repo.setCourseHero(courseKajabiId, url, now.toISOString());
  return "updated";
}
