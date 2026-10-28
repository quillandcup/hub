/**
 * A course's hero image from Kajabi's admin (docs/COURSES.md, step B): the banner behind the course title.
 * It is not the thumbnail and Kajabi's public API doesn't return it. The admin product page loads data as JSON
 * (which request is not documented: a direct request to /api/admin/products/{id} never arrives), which
 * scripts/kajabi-course-content.ts searches from a logged-in session and
 * hands to this module. The field's name isn't documented, so the JSON is searched for an image URL under a
 * key that says hero, banner, cover or background (never the thumbnail), and the script prints which key it
 * used, or the image-like keys it saw, so a miss is easy to fix.
 *
 * The URL goes to the Bronze course row (`hero_image_url`, a column the API import never writes); processing
 * copies it to Silver and the course-images copy step stores our own copy. Re-running with the same URL
 * writes nothing.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

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
  const bronze = supabase.schema("bronze");
  const { data, error } = await bronze.from("kajabi_courses").select("hero_image_url").eq("kajabi_id", courseKajabiId).is("deleted_at", null).maybeSingle();
  if (error) throw new Error(`kajabi_courses read failed: ${error.message}`);
  if (!data) return "missing";
  if (data.hero_image_url === url) return "unchanged";
  if (!options.dryRun) {
    const { error: updateError } = await bronze.from("kajabi_courses").update({ hero_image_url: url, hero_captured_at: now.toISOString() }).eq("kajabi_id", courseKajabiId);
    if (updateError) throw new Error(`kajabi_courses update failed: ${updateError.message}`);
  }
  return "updated";
}
