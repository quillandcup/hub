import { createRepos } from "@/lib/data/repos";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildAliasMap, resolveEmail } from "@/lib/email-aliases";
import { computeCourseAccess, type AccessRow } from "@/lib/courses/access";
import { sanitizeLessonHtml } from "@/lib/courses/sanitize";
import { lessonExcerpt } from "@/lib/courses/excerpt";
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

/**
 * Gives every live Bronze course a `courses` row, so each has a Hub id for its admin address. A new
 * row starts as a draft (`is_draft`: hidden from members; availability is separate from where the
 * course is authored). Existing rows are left alone, and a title whose slug is empty or already
 * taken is skipped (processing it by slug reports the problem).
 */
export async function ensureDraftCourses(supabase: SupabaseClient): Promise<number> {
  const repos = createRepos(supabase);
  const bronze = await repos.kajabiCourses.liveCourses();
  const rows = await repos.courses.courses();
  const have = new Set(rows.filter((r) => r.source === "kajabi").map((r) => r.source_key));
  const slugs = new Set(rows.map((r) => r.slug));
  const drafts: { slug: string; title: string; description: string | null; source: string; source_key: string; is_draft: boolean }[] = [];
  for (const c of bronze) {
    if (have.has(c.kajabi_id)) continue;
    const slug = slugifyTitle(c.title);
    if (!slug || slugs.has(slug)) {
      console.warn(`Kajabi course ${c.kajabi_id} has no draft row: its slug is empty or already taken`);
      continue;
    }
    slugs.add(slug);
    drafts.push({ slug, title: c.title, description: (c.raw_payload as any)?.attributes?.description ?? null, source: "kajabi", source_key: c.kajabi_id, is_draft: true });
  }
  await repos.courses.createCourses(drafts);
  return drafts.length;
}

export interface ProcessCoursesOptions {
  /** Silver slug of the course to refresh (a new course gets the slug of its Kajabi title); omit to refresh every Kajabi course that has a row. */
  courseSlug?: string;
  /** Make the course available to members (clears `is_draft`) as part of this run. Processing never publishes on its own. */
  publish?: boolean;
  /** Access length as an interval ("1 year", "P1Y"); set on the course when given, otherwise left as is (null = lifetime). */
  accessDuration?: string | null;
  /** When the course opens, as an instant; set when given (null clears it), otherwise left as is. Early buyers' access starts then. */
  launchAt?: string | null;
}

export interface ProcessCoursesResult {
  courses: {
    slug: string;
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

/** Rebuild `course_access` for the given Silver courses: upsert what's derived, delete what no longer is (no gap for members mid-run). */
export async function rebuildCourseAccess(
  supabase: SupabaseClient,
  courses: { id: string; kajabi_id: string; access_duration: string | null; launch_at: string | null }[]
): Promise<{ members: number; removed: Map<string, number>; rows: AccessRow[] }> {
  if (courses.length === 0) return { members: 0, removed: new Map(), rows: [] };

  const offerRows = await createRepos(supabase).kajabiCourses.liveOffers(courses.map((c) => c.kajabi_id));
  const offerIdsByCourse = new Map<string, Set<string>>();
  for (const o of offerRows) {
    if (!offerIdsByCourse.has(o.course_kajabi_id)) offerIdsByCourse.set(o.course_kajabi_id, new Set());
    offerIdsByCourse.get(o.course_kajabi_id)!.add(o.offer_kajabi_id);
  }
  const allOfferIds = Array.from(new Set(offerRows.map((o) => o.offer_kajabi_id)));

  const billing = createRepos(supabase).billing;
  const purchases = await billing.kajabiPurchases({ offerIds: allOfferIds });
  const customerIds = Array.from(new Set(purchases.map((p) => p.kajabi_customer_id).filter((id): id is string => !!id)));
  const customers = await billing.kajabiCustomers({ customerIds });
  const aliases = await createRepos(supabase).aliases.emailAliases({ activeOnly: true });
  const aliasMap = buildAliasMap(aliases);
  const emailByCustomerId = new Map<string, string>();
  for (const c of customers) if (c.email) emailByCustomerId.set(c.kajabi_customer_id, resolveEmail(c.email, aliasMap));

  const emails = Array.from(new Set(emailByCustomerId.values()));
  const memberIdByEmail = new Map<string, string>();
  for (const m of await createRepos(supabase).members.byEmails(emails)) memberIdByEmail.set(m.email.toLowerCase(), m.id);

  const progress = createRepos(supabase).courseProgress;
  const grants = await progress.grantsOfCourses(courses.map((c) => c.id));

  const rows = computeCourseAccess({
    courses: courses.map((c) => ({
      id: c.id,
      offerIds: offerIdsByCourse.get(c.kajabi_id) ?? new Set(),
      accessDuration: c.access_duration,
      launchAt: c.launch_at,
    })),
    // the offer filter above already leaves out a purchase with no offer
    purchases: purchases.flatMap((p) => (p.kajabi_offer_id ? [{ ...p, kajabi_offer_id: p.kajabi_offer_id }] : [])),
    emailByCustomerId,
    memberIdByEmail,
    grants,
  });

  await progress.upsertAccess(rows);

  // Stale rows: derived before, not derived now (a refund, a removed grant).
  const keep = new Set(rows.map((r) => `${r.member_id}|${r.course_id}`));
  const existing = await progress.accessOfCourses(courses.map((c) => c.id));
  const staleByCourse = new Map<string, string[]>();
  for (const e of existing) {
    if (keep.has(`${e.member_id}|${e.course_id}`)) continue;
    staleByCourse.set(e.course_id, [...(staleByCourse.get(e.course_id) ?? []), e.member_id]);
  }
  const removed = new Map<string, number>();
  for (const [courseId, memberIds] of staleByCourse) {
    await progress.removeAccess(courseId, memberIds);
    removed.set(courseId, memberIds.length);
  }
  return { members: new Set(rows.map((r) => r.member_id)).size, removed, rows };
}

export async function processCourses(
  supabase: SupabaseClient,
  options: ProcessCoursesOptions = {}
): Promise<ProcessCoursesResult> {
  await ensureDraftCourses(supabase);
  // Which Bronze courses to sync.
  const repos = createRepos(supabase);
  const bronzeCourses = await repos.kajabiCourses.liveCourses();
  const existingSilver = await repos.courses.courses({ source: "kajabi" });
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
    // Drafts too: their content syncs so staff can build and preview it. Only access follows availability.
    targets = bronzeCourses.filter((c) => silverByKey.has(c.kajabi_id));
  }

  const result: ProcessCoursesResult = { courses: [] };
  const accessCourses: { id: string; kajabi_id: string; access_duration: string | null; launch_at: string | null; index: number }[] = [];

  for (const bc of targets) {
    const kajabiId: string = bc.kajabi_id;
    const description: string | null = bc.raw_payload?.attributes?.description ?? null;
    const thumbnailUrl: string | null = bc.raw_payload?.attributes?.thumbnail_url || null;
    // The banner behind the title: captured from the Kajabi admin, not in the API payload (null until courses:content has run).
    const heroUrl: string | null = bc.hero_image_url || null;
    let silver = silverByKey.get(kajabiId);

    if (!silver) {
      const slug = slugifyTitle(bc.title);
      if (!slug) throw new CourseProcessingError(`Course "${bc.title}" has no usable slug`);
      const programId = await repos.programs.idBySlug(slug);
      silver = await repos.courses.createCourse({
        slug,
        title: bc.title,
        description,
        thumbnail_url: thumbnailUrl,
        hero_url: heroUrl,
        source: "kajabi",
        source_key: kajabiId,
        program_id: programId,
        is_draft: !options.publish,
        ...(options.accessDuration !== undefined ? { access_duration: options.accessDuration } : {}),
        ...(options.launchAt !== undefined ? { launch_at: options.launchAt } : {}),
      });
    } else {
      // A course made as a draft gets its program the way a new course does.
      const programId = silver.program_id ?? (await repos.programs.idBySlug(silver.slug));
      const updated = await repos.courses.updateCourse(silver.id, {
        ...(options.publish ? { is_draft: false } : {}),
        program_id: programId,
        title: bc.title,
        description,
        thumbnail_url: thumbnailUrl,
        hero_url: heroUrl,
        ...(options.accessDuration !== undefined ? { access_duration: options.accessDuration } : {}),
        ...(options.launchAt !== undefined ? { launch_at: options.launchAt } : {}),
      });
      if (!updated) throw new Error("courses update failed: the course is gone");
      silver = updated;
    }
    const courseId: string = silver!.id;

    const modules = await repos.kajabiCourses.liveModules(kajabiId);
    const lessons = await repos.kajabiCourses.liveLessons(kajabiId);

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
      // The module's own setting as Kajabi gives it (or nothing): the state above follows from it and what is above it.
      publishing_option: m.publishing_option ?? null,
      source: "kajabi",
      source_key: m.kajabi_id,
    });
    const isNested = (m: any) => Boolean(m.parent_kajabi_id && tree.modules.has(m.parent_kajabi_id));
    const roots = modules.filter((m) => !isNested(m));
    const nested = modules.filter(isNested);
    const moduleIds = await repos.courses.upsertModules(roots.map((m) => moduleRow(m, null)));
    for (const [key, id] of await repos.courses.upsertModules(nested.map((m) => moduleRow(m)))) {
      moduleIds.set(key, id);
    }
    if (nested.length > 0) {
      await repos.courses.upsertModules(nested.map((m) => moduleRow(m, moduleIds.get(m.parent_kajabi_id!)!)));
    }

    // Lessons. A video is linked only when its Local `videos` row exists; lessons without one are
    // upserted without a video_id column at all, so a link made earlier isn't wiped by a re-run.
    const mediaIds = Array.from(new Set(lessons.map((l) => l.video_media_id).filter(Boolean)));
    const videoIdByMedia = new Map<string, string>();
    for (const v of await repos.courses.videosBySourceKeys("kajabi", mediaIds as string[])) videoIdByMedia.set(v.source_key, v.id);
    const lessonRow = (l: any) => ({
      course_id: courseId,
      module_id: l.module_kajabi_id ? moduleIds.get(l.module_kajabi_id) ?? null : null,
      title: l.title,
      position: l.position ?? 0,
      state: stateOf(tree.lessons, l.kajabi_id),
      publishing_option: l.publishing_option ?? null,
      body_html: sanitizeLessonHtml(l.body_html),
      excerpt: lessonExcerpt(sanitizeLessonHtml(l.body_html)),
      thumbnail_url: l.thumbnail_url ?? null,
      duration_seconds: l.video_duration_seconds ?? null,
      source: "kajabi",
      source_key: l.kajabi_id,
    });
    const withVideo = lessons.filter((l) => l.video_media_id && videoIdByMedia.has(l.video_media_id));
    const withoutVideo = lessons.filter((l) => !(l.video_media_id && videoIdByMedia.has(l.video_media_id)));
    await repos.courses.upsertLessons(withVideo.map((l) => ({ ...lessonRow(l), video_id: videoIdByMedia.get(l.video_media_id!) })));
    await repos.courses.upsertLessons(withoutVideo.map(lessonRow));

    // Orphans: Silver rows (kajabi-sourced, this course) whose source is gone from Kajabi. A lesson that
    // became a draft stays, as `hidden` (and keeps its members' progress).
    const silverLessons = await repos.courses.lessonsOf([courseId], { source: "kajabi", includeHidden: true });
    const staleLessons = silverLessons.filter((r) => !tree.lessons.has(r.source_key as string)).map((r) => r.id);
    await repos.courses.deleteLessons(staleLessons);
    const silverModules = await repos.courses.modulesOf([courseId], { source: "kajabi", includeHidden: true });
    const staleModules = silverModules.filter((r) => !tree.modules.has(r.source_key as string)).map((r) => r.id);
    await repos.courses.deleteModules(staleModules);

    // Members get access only to a course that is available to them.
    if (!silver!.is_draft) accessCourses.push({ id: courseId, kajabi_id: kajabiId, access_duration: silver!.access_duration, launch_at: silver!.launch_at, index: result.courses.length });
    result.courses.push({
      slug: silver!.slug,
      modules: modules.length - countOf(tree.modules, "hidden"),
      lessons: lessons.length - countOf(tree.lessons, "hidden"),
      comingSoon: countOf(tree.lessons, "coming_soon"),
      hiddenLessons: countOf(tree.lessons, "hidden"),
      deleted: { modules: staleModules.length, lessons: staleLessons.length },
      access: { members: 0, removed: 0 },
    });
  }

  const access = await rebuildCourseAccess(supabase, accessCourses);
  for (const c of accessCourses) {
    result.courses[c.index].access = {
      members: access.rows.filter((r) => r.course_id === c.id).length,
      removed: access.removed.get(c.id) ?? 0,
    };
  }
  return result;
}
