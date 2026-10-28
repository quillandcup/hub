import { createRepos } from "@/lib/data/repos";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildAliasMap, resolveEmail } from "@/lib/email-aliases";
import { fetchAllBronzeRows } from "@/lib/supabase/bronze-pagination";
import { computeCourseAccess, type AccessRow } from "@/lib/courses/access";
import { sanitizeLessonHtml } from "@/lib/courses/sanitize";
import { lessonExcerpt } from "@/lib/courses/excerpt";
import { fetchAll } from "@/lib/courses/db";
import { planFullTree, slugifyTitle } from "@/lib/courses/visibility";

/**
 * Bronze (Kajabi) + Local -> Silver courses (docs/COURSES.md, step C).
 *
 * Silver rows are upserted on their source key and orphans are deleted, like `prickles`, so
 * course, module and lesson ids (and `/courses/<slug>/lessons/<id>` URLs) stay stable across
 * runs. Only `source = 'kajabi'` rows are touched, so Hub-authored rows (once the builder
 * exists) are never reprocessed away. A course's slug is set when it's first created and never
 * changes after, even if the Kajabi title does.
 */

const BATCH = 500;
const LOOKUP_BATCH = 200;

function chunks<T>(rows: T[], size = BATCH): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

export interface ProcessCoursesOptions {
  /** Silver slug of the course to create or refresh; omit to refresh every Kajabi course already in Silver. */
  courseSlug?: string;
  /** Access length as an interval ("1 year", "P1Y"); set on the course when given, otherwise left as is (null = lifetime). */
  accessDuration?: string | null;
  /** When the course opens, as an instant; set when given (null clears it), otherwise left as is. Early buyers' access starts then. */
  launchAt?: string | null;
}

export interface ProcessCoursesResult {
  courses: {
    slug: string;
    created: boolean;
    modules: number;
    lessons: number;
    comingSoon: number;
    hiddenLessons: number;
    deleted: { modules: number; lessons: number };
    access: { members: number; removed: number };
  }[];
}

export class CourseProcessingError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

async function upsertAll(supabase: SupabaseClient, table: string, rows: object[], onConflict: string) {
  const ids = new Map<string, string>();
  for (const batch of chunks(rows)) {
    const { data, error } = await supabase.from(table).upsert(batch, { onConflict }).select("id, source_key");
    if (error) throw new Error(`${table} upsert failed: ${error.message}`);
    for (const r of data ?? []) ids.set(r.source_key, r.id);
  }
  return ids;
}

async function deleteIds(supabase: SupabaseClient, table: string, ids: string[]) {
  for (const batch of chunks(ids)) {
    const { error } = await supabase.from(table).delete().in("id", batch);
    if (error) throw new Error(`${table} delete failed: ${error.message}`);
  }
}

/** Rebuild `course_access` for the given Silver courses: upsert what's derived, delete what no longer is (no gap for members mid-run). */
export async function rebuildCourseAccess(
  supabase: SupabaseClient,
  courses: { id: string; kajabi_id: string; access_duration: string | null; launch_at: string | null }[]
): Promise<{ members: number; removed: Map<string, number>; rows: AccessRow[] }> {
  if (courses.length === 0) return { members: 0, removed: new Map(), rows: [] };

  const offerRows = await fetchAllBronzeRows(supabase, "kajabi_course_offers", "course_kajabi_id, offer_kajabi_id", (q) =>
    q.in("course_kajabi_id", courses.map((c) => c.kajabi_id)).is("deleted_at", null)
  );
  const offerIdsByCourse = new Map<string, Set<string>>();
  for (const o of offerRows) {
    if (!offerIdsByCourse.has(o.course_kajabi_id)) offerIdsByCourse.set(o.course_kajabi_id, new Set());
    offerIdsByCourse.get(o.course_kajabi_id)!.add(o.offer_kajabi_id);
  }
  const allOfferIds = Array.from(new Set(offerRows.map((o) => o.offer_kajabi_id)));

  const purchases: any[] = [];
  for (const batch of chunks(allOfferIds, LOOKUP_BATCH)) {
    purchases.push(
      ...(await fetchAllBronzeRows(
        supabase,
        "kajabi_purchases",
        "kajabi_customer_id, kajabi_offer_id, created_at_kajabi, effective_start_at, deactivated_at",
        (q) => q.in("kajabi_offer_id", batch)
      ))
    );
  }

  const customerIds = Array.from(new Set(purchases.map((p) => p.kajabi_customer_id).filter(Boolean)));
  const customers: any[] = [];
  for (const batch of chunks(customerIds, LOOKUP_BATCH)) {
    customers.push(
      ...(await fetchAllBronzeRows(supabase, "kajabi_customers", "kajabi_customer_id, email", (q) =>
        q.in("kajabi_customer_id", batch)
      ))
    );
  }
  const aliases = await createRepos(supabase).aliases.emailAliases({ activeOnly: true });
  const aliasMap = buildAliasMap(aliases);
  const emailByCustomerId = new Map<string, string>();
  for (const c of customers) if (c.email) emailByCustomerId.set(c.kajabi_customer_id, resolveEmail(c.email, aliasMap));

  const emails = Array.from(new Set(emailByCustomerId.values()));
  const memberIdByEmail = new Map<string, string>();
  for (const m of await createRepos(supabase).members.byEmails(emails)) memberIdByEmail.set(m.email.toLowerCase(), m.id);

  const grants = await fetchAll(supabase, "course_access_grants", "member_id, course_id, starts_at, ends_at", (q) =>
    q.in("course_id", courses.map((c) => c.id))
  );

  const rows = computeCourseAccess({
    courses: courses.map((c) => ({
      id: c.id,
      offerIds: offerIdsByCourse.get(c.kajabi_id) ?? new Set(),
      accessDuration: c.access_duration,
      launchAt: c.launch_at,
    })),
    purchases,
    emailByCustomerId,
    memberIdByEmail,
    grants,
  });

  for (const batch of chunks(rows)) {
    const { error } = await supabase.from("course_access").upsert(batch, { onConflict: "member_id,course_id" });
    if (error) throw new Error(`course_access upsert failed: ${error.message}`);
  }

  // Stale rows: derived before, not derived now (a refund, a removed grant).
  const keep = new Set(rows.map((r) => `${r.member_id}|${r.course_id}`));
  const existing = await fetchAll(supabase, "course_access", "member_id, course_id", (q) =>
    q.in("course_id", courses.map((c) => c.id))
  );
  const removed = new Map<string, number>();
  for (const e of existing) {
    if (keep.has(`${e.member_id}|${e.course_id}`)) continue;
    const { error } = await supabase.from("course_access").delete().eq("member_id", e.member_id).eq("course_id", e.course_id);
    if (error) throw new Error(`course_access delete failed: ${error.message}`);
    removed.set(e.course_id, (removed.get(e.course_id) ?? 0) + 1);
  }
  return { members: new Set(rows.map((r) => r.member_id)).size, removed, rows };
}

export async function processCourses(
  supabase: SupabaseClient,
  options: ProcessCoursesOptions = {}
): Promise<ProcessCoursesResult> {
  // Which Bronze courses to publish.
  const bronzeCourses = await fetchAllBronzeRows(supabase, "kajabi_courses", "kajabi_id, title, raw_payload, hero_image_url", (q) =>
    q.is("deleted_at", null)
  );
  const existingSilver = await fetchAll(
    supabase,
    "courses",
    "id, slug, source_key, access_duration, launch_at, program_id",
    (q) => q.eq("source", "kajabi")
  );
  const silverByKey = new Map(existingSilver.map((c) => [c.source_key, c]));

  let targets: any[];
  if (options.courseSlug) {
    const wanted = options.courseSlug;
    targets = bronzeCourses.filter((c) => {
      const silver = silverByKey.get(c.kajabi_id);
      return (silver ? silver.slug : slugifyTitle(c.title)) === wanted;
    });
    if (targets.length === 0) {
      const known = bronzeCourses.map((c) => silverByKey.get(c.kajabi_id)?.slug ?? slugifyTitle(c.title)).sort();
      throw new CourseProcessingError(`No Kajabi course matches "${wanted}". Known: ${known.join(", ") || "none"}`, 404);
    }
    if (targets.length > 1) throw new CourseProcessingError(`More than one Kajabi course matches "${wanted}"`);
  } else {
    targets = bronzeCourses.filter((c) => silverByKey.has(c.kajabi_id));
  }

  const result: ProcessCoursesResult = { courses: [] };
  const accessCourses: { id: string; kajabi_id: string; access_duration: string | null; launch_at: string | null }[] = [];

  for (const bc of targets) {
    const kajabiId: string = bc.kajabi_id;
    const description: string | null = bc.raw_payload?.attributes?.description ?? null;
    const thumbnailUrl: string | null = bc.raw_payload?.attributes?.thumbnail_url || null;
    // The banner behind the title: captured from the Kajabi admin, not in the API payload (null until courses:content has run).
    const heroUrl: string | null = bc.hero_image_url || null;
    let silver = silverByKey.get(kajabiId);
    const created = !silver;

    if (!silver) {
      const slug = slugifyTitle(bc.title);
      if (!slug) throw new CourseProcessingError(`Course "${bc.title}" has no usable slug`);
      const { data: program } = await supabase.from("programs").select("id").eq("slug", slug).maybeSingle();
      const { data, error } = await supabase
        .from("courses")
        .insert({
          slug,
          title: bc.title,
          description,
          thumbnail_url: thumbnailUrl,
          hero_url: heroUrl,
          source: "kajabi",
          source_key: kajabiId,
          program_id: program?.id ?? null,
          ...(options.accessDuration !== undefined ? { access_duration: options.accessDuration } : {}),
          ...(options.launchAt !== undefined ? { launch_at: options.launchAt } : {}),
        })
        .select("id, slug, source_key, access_duration, launch_at, program_id")
        .single();
      if (error) throw new Error(`courses insert failed: ${error.message}`);
      silver = data;
    } else {
      const { data, error } = await supabase
        .from("courses")
        .update({
          title: bc.title,
          description,
          thumbnail_url: thumbnailUrl,
          hero_url: heroUrl,
          ...(options.accessDuration !== undefined ? { access_duration: options.accessDuration } : {}),
          ...(options.launchAt !== undefined ? { launch_at: options.launchAt } : {}),
        })
        .eq("id", silver.id)
        .select("id, slug, source_key, access_duration, launch_at, program_id")
        .single();
      if (error) throw new Error(`courses update failed: ${error.message}`);
      silver = data;
    }
    const courseId: string = silver!.id;

    const modules = await fetchAllBronzeRows(supabase, "kajabi_course_modules", "*", (q) =>
      q.eq("course_kajabi_id", kajabiId).is("deleted_at", null)
    );
    const lessons = await fetchAllBronzeRows(supabase, "kajabi_course_lessons", "*", (q) =>
      q.eq("course_kajabi_id", kajabiId).is("deleted_at", null)
    );

    // Every module and lesson is stored with its effective state. A Kajabi draft (or anything under
    // one) is `hidden`: kept so staff can preview it, never shown to members (docs/COURSES.md).
    const tree = planFullTree(
      modules.map((m) => ({ kajabiId: m.kajabi_id, parentKajabiId: m.parent_kajabi_id, publishingOption: m.publishing_option })),
      lessons.map((l) => ({ kajabiId: l.kajabi_id, moduleKajabiId: l.module_kajabi_id, publishingOption: l.publishing_option }))
    );
    const stateOf = (states: Map<string, string>, kajabiId: string) => states.get(kajabiId) ?? "hidden";
    const countOf = (states: Map<string, string>, wanted: string) => [...states.values()].filter((state) => state === wanted).length;

    // Modules in two passes so ids are known before parents are linked. Pass 1 writes roots with
    // parent_id null and nested modules without a parent_id column at all (a re-run never nulls an
    // existing link); pass 2 sets the parent of every nested module.
    const moduleRow = (m: any, parentId?: string | null) => ({
      course_id: courseId,
      ...(parentId !== undefined ? { parent_id: parentId } : {}),
      title: m.title,
      position: m.position ?? 0,
      poster_url: m.poster_url ?? null,
      state: stateOf(tree.modules, m.kajabi_id),
      source: "kajabi",
      source_key: m.kajabi_id,
    });
    const isNested = (m: any) => Boolean(m.parent_kajabi_id && tree.modules.has(m.parent_kajabi_id));
    const roots = modules.filter((m) => !isNested(m));
    const nested = modules.filter(isNested);
    const moduleIds = await upsertAll(supabase, "course_modules", roots.map((m) => moduleRow(m, null)), "source,source_key");
    for (const [key, id] of await upsertAll(supabase, "course_modules", nested.map((m) => moduleRow(m)), "source,source_key")) {
      moduleIds.set(key, id);
    }
    if (nested.length > 0) {
      await upsertAll(
        supabase,
        "course_modules",
        nested.map((m) => moduleRow(m, moduleIds.get(m.parent_kajabi_id)!)),
        "source,source_key"
      );
    }

    // Lessons. A video is linked only when its Local `videos` row exists; lessons without one are
    // upserted without a video_id column at all, so a link made earlier isn't wiped by a re-run.
    const mediaIds = Array.from(new Set(lessons.map((l) => l.video_media_id).filter(Boolean)));
    const videoIdByMedia = new Map<string, string>();
    for (const batch of chunks(mediaIds, LOOKUP_BATCH)) {
      const { data, error } = await supabase
        .from("videos")
        .select("id, source_key")
        .eq("source_kind", "kajabi")
        .in("source_key", batch);
      if (error) throw new Error(`videos read failed: ${error.message}`);
      for (const v of data ?? []) videoIdByMedia.set(v.source_key, v.id);
    }
    const lessonRow = (l: any) => ({
      course_id: courseId,
      module_id: l.module_kajabi_id ? moduleIds.get(l.module_kajabi_id) ?? null : null,
      title: l.title,
      position: l.position ?? 0,
      state: stateOf(tree.lessons, l.kajabi_id),
      body_html: sanitizeLessonHtml(l.body_html),
      excerpt: lessonExcerpt(sanitizeLessonHtml(l.body_html)),
      thumbnail_url: l.thumbnail_url ?? null,
      duration_seconds: l.video_duration_seconds ?? null,
      source: "kajabi",
      source_key: l.kajabi_id,
    });
    const withVideo = lessons.filter((l) => l.video_media_id && videoIdByMedia.has(l.video_media_id));
    const withoutVideo = lessons.filter((l) => !(l.video_media_id && videoIdByMedia.has(l.video_media_id)));
    await upsertAll(
      supabase,
      "course_lessons",
      withVideo.map((l) => ({ ...lessonRow(l), video_id: videoIdByMedia.get(l.video_media_id) })),
      "source,source_key"
    );
    await upsertAll(supabase, "course_lessons", withoutVideo.map(lessonRow), "source,source_key");

    // Orphans: Silver rows (kajabi-sourced, this course) whose source is gone from Kajabi. A lesson that
    // became a draft stays, as `hidden` (and keeps its members' progress).
    const silverLessons = await fetchAll(supabase, "course_lessons", "id, source_key", (q) =>
      q.eq("course_id", courseId).eq("source", "kajabi")
    );
    const staleLessons = silverLessons.filter((r) => !tree.lessons.has(r.source_key)).map((r) => r.id);
    await deleteIds(supabase, "course_lessons", staleLessons);
    const silverModules = await fetchAll(supabase, "course_modules", "id, source_key", (q) =>
      q.eq("course_id", courseId).eq("source", "kajabi")
    );
    const staleModules = silverModules.filter((r) => !tree.modules.has(r.source_key)).map((r) => r.id);
    await deleteIds(supabase, "course_modules", staleModules);

    accessCourses.push({ id: courseId, kajabi_id: kajabiId, access_duration: silver!.access_duration, launch_at: silver!.launch_at });
    result.courses.push({
      slug: silver!.slug,
      created,
      modules: modules.length - countOf(tree.modules, "hidden"),
      lessons: lessons.length - countOf(tree.lessons, "hidden"),
      comingSoon: countOf(tree.lessons, "coming_soon"),
      hiddenLessons: countOf(tree.lessons, "hidden"),
      deleted: { modules: staleModules.length, lessons: staleLessons.length },
      access: { members: 0, removed: 0 },
    });
  }

  const access = await rebuildCourseAccess(supabase, accessCourses);
  for (const [i, c] of accessCourses.entries()) {
    result.courses[i].access = {
      members: access.rows.filter((r) => r.course_id === c.id).length,
      removed: access.removed.get(c.id) ?? 0,
    };
  }
  return result;
}
