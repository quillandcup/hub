"use server";

import { revalidatePath } from "next/cache";
import { requireAdminAction } from "@/lib/admin-auth";
import { withAction } from "@/lib/analytics/server";
import { CourseWriteError } from "@/lib/data/courses";
import { createRepos } from "@/lib/data/repos";
import { isId } from "@/lib/ids";
import { parseItemTitle } from "@/lib/courses/editor";
import { lessonExcerpt } from "@/lib/courses/excerpt";
import { COURSE_FILES_BUCKET } from "@/lib/courses/file-format";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { sanitizeLessonHtml } from "@/lib/courses/sanitize";

/**
 * The course editor's outline writes: add, rename, delete, duplicate and reorder the modules and
 * lessons of a Hub-owned course. Each runs as the signed-in admin with their own client, so the
 * database policies decide what they may touch (never a course imported from Kajabi) and the audit
 * log names them (migration 20270317000000). Reordering and duplicating are single database calls,
 * so they happen completely or not at all.
 */

type Auth = Extract<Awaited<ReturnType<typeof requireAdminAction>>, { ok: true }>;
export type OutlineResult = { error?: string; id?: string };
export type ItemKind = "module" | "lesson";

const PREFIX = { module: "mod", lesson: "les" } as const;
const MAX_REORDER = 500;
const MAX_LESSON_TEXT = 200_000;
const NOT_EDITABLE = "That course can't be edited here: it isn't in the Hub, or it's imported from Kajabi.";

type DbError = { code?: string; message: string };

/** What a database refusal means for the person editing, in their words. */
function describe(error: DbError, what: string): string {
  if (error.code === "42501") return NOT_EDITABLE;
  if (error.message === "stale_order") return "The outline changed since you opened it. Refresh the page and try again.";
  if (error.message === "not_editable") return NOT_EDITABLE;
  if (error.message === "not_found") return "That has been deleted. Refresh the page.";
  if (error.message === "unsupported_status") return "That setting isn't available yet.";
  if (error.code === "23514" || error.code === "23503") return error.message.startsWith("A ") ? error.message : "That doesn't fit there.";
  console.error(`course outline: ${what} failed:`, error.message);
  return `Couldn't ${what}.`;
}

function revalidate(courseId: string) {
  revalidatePath(`/admin/courses/${courseId}`);
  revalidatePath("/courses", "layout");
}

/** A refused or failed write as the {@link DbError} `describe` explains; a database refusal keeps its code. */
const asDbError = (error: unknown): DbError => ({ code: error instanceof CourseWriteError ? error.code : undefined, message: error instanceof Error ? error.message : String(error) });

async function addModuleImpl(auth: Auth, courseId: string, parentModuleId: string | null, title: string): Promise<OutlineResult> {
  if (!isId(courseId, "crs") || (parentModuleId !== null && !isId(parentModuleId, "mod"))) return { error: "Course not found." };
  const name = parseItemTitle(title);
  if (!name.ok) return { error: name.error };

  const courses = createRepos(auth.supabase).courses;
  try {
    const position = await courses.nextPosition("module", courseId, parentModuleId);
    // A new item follows what is above it (the database works out its state from that).
    const id = await courses.addModule({ course_id: courseId, parent_id: parentModuleId, title: name.title, position, publishing_option: "draft", source: "hub" });
    revalidate(courseId);
    return { id };
  } catch (error) {
    return { error: describe(asDbError(error), "add the module") };
  }
}

async function addLessonImpl(auth: Auth, courseId: string, moduleId: string, title: string): Promise<OutlineResult> {
  if (!isId(courseId, "crs") || !isId(moduleId, "mod")) return { error: "Course not found." };
  const name = parseItemTitle(title);
  if (!name.ok) return { error: name.error };

  const courses = createRepos(auth.supabase).courses;
  try {
    const position = await courses.nextPosition("lesson", courseId, moduleId);
    const id = await courses.addLesson({ course_id: courseId, module_id: moduleId, title: name.title, position, publishing_option: "draft", source: "hub" });
    revalidate(courseId);
    return { id };
  } catch (error) {
    return { error: describe(asDbError(error), "add the lesson") };
  }
}

async function renameItemImpl(auth: Auth, courseId: string, kind: ItemKind, id: string, title: string): Promise<OutlineResult> {
  if (!isId(courseId, "crs") || !(kind in PREFIX) || !isId(id, PREFIX[kind])) return { error: "Not found." };
  const name = parseItemTitle(title);
  if (!name.ok) return { error: name.error };

  try {
    if (!(await createRepos(auth.supabase).courses.renameItem(kind, { id, courseId }, name.title))) return { error: NOT_EDITABLE };
  } catch (error) {
    return { error: describe(asDbError(error), "rename it") };
  }
  revalidate(courseId);
  return { id };
}

async function saveLessonTextImpl(auth: Auth, courseId: string, lessonId: string, html: string): Promise<OutlineResult> {
  if (!isId(courseId, "crs") || !isId(lessonId, "les")) return { error: "Not found." };
  if (typeof html !== "string" || html.length > MAX_LESSON_TEXT) return { error: "That text is too long." };

  // The same allowlist as the Kajabi import: what is stored is never what the browser sent.
  // The editor leaves an empty paragraph after a list or a quote to type in; it is not part of the text.
  const cleaned = sanitizeLessonHtml(html)?.replace(/(<p>\s*<\/p>\s*)+$/i, "") ?? null;
  const excerpt = lessonExcerpt(cleaned);
  // Empty paragraphs are not text: a lesson with nothing but those has no text (an image alone still counts).
  const body = excerpt === null && !/<img\b/i.test(cleaned ?? "") ? null : cleaned;
  try {
    if (!(await createRepos(auth.supabase).courses.setLessonText({ id: lessonId, courseId }, { body_html: body, excerpt }))) return { error: NOT_EDITABLE };
  } catch (error) {
    return { error: describe(asDbError(error), "save the text") };
  }
  revalidate(courseId);
  return { id: lessonId };
}

async function deleteItemImpl(auth: Auth, courseId: string, kind: ItemKind, id: string): Promise<OutlineResult> {
  if (!isId(courseId, "crs") || !(kind in PREFIX) || !isId(id, PREFIX[kind])) return { error: "Not found." };

  // A lesson members have worked through is theirs too: deleting it would erase their progress.
  const repos = createRepos(auth.supabase);
  let storedFiles: string[] = [];
  try {
    const lessonIds = await repos.courses.lessonIdsUnder(kind, id);
    if (lessonIds.length > 0 && (await repos.courseProgress.hasProgressIn(lessonIds))) {
      return { error: `Members have progress in ${kind === "lesson" ? "this lesson" : "its lessons"}, so it can't be deleted. Hide it instead.` };
    }
    // The downloads' rows go with the lesson; the files they point at are in the bucket and are removed below.
    if (lessonIds.length > 0) storedFiles = (await repos.courses.filesOfLessons(lessonIds)).map((f) => f.storage_path);
    if (!(await repos.courses.deleteItem(kind, { id, courseId }))) return { error: NOT_EDITABLE };
  } catch (error) {
    return { error: describe(asDbError(error), "delete it") };
  }
  await removeStoredFiles(storedFiles);
  revalidate(courseId);
  return { id };
}

/** Takes files out of the downloads bucket once nothing points at them. A failure leaves an unreferenced object, which is logged, not shown: the delete itself worked. */
async function removeStoredFiles(paths: string[]) {
  if (paths.length === 0) return;
  try {
    const bucket = createServiceRoleClient().storage.from(COURSE_FILES_BUCKET);
    for (let i = 0; i < paths.length; i += 100) {
      const { error } = await bucket.remove(paths.slice(i, i + 100));
      if (error) console.error("course outline: couldn't remove stored files:", error.message);
    }
  } catch (error) {
    console.error("course outline: couldn't remove stored files:", error instanceof Error ? error.message : error);
  }
}

async function duplicateItemImpl(auth: Auth, courseId: string, kind: ItemKind, id: string): Promise<OutlineResult> {
  if (!isId(courseId, "crs") || !(kind in PREFIX) || !isId(id, PREFIX[kind])) return { error: "Not found." };
  try {
    const copyId = await createRepos(auth.supabase).courses.duplicateItem(kind, id);
    revalidate(courseId);
    return { id: copyId };
  } catch (error) {
    return { error: describe(asDbError(error), "duplicate it") };
  }
}

async function reorderItemsImpl(auth: Auth, courseId: string, kind: ItemKind, parentId: string | null, orderedIds: string[]): Promise<OutlineResult> {
  if (!isId(courseId, "crs") || !(kind in PREFIX) || (parentId !== null && !isId(parentId, "mod"))) return { error: "Not found." };
  if (!Array.isArray(orderedIds) || orderedIds.length === 0 || orderedIds.length > MAX_REORDER || !orderedIds.every((id) => isId(id, PREFIX[kind]))) return { error: "Not found." };

  try {
    await createRepos(auth.supabase).courses.reorderChildren({ courseId, kind, parentId, ids: orderedIds });
  } catch (error) {
    return { error: describe(asDbError(error), "reorder them") };
  }
  revalidate(courseId);
  return { id: courseId };
}

async function setItemStatusImpl(auth: Auth, courseId: string, kind: ItemKind, id: string, option: string): Promise<OutlineResult> {
  if (!isId(courseId, "crs") || !(kind in PREFIX) || !isId(id, PREFIX[kind])) return { error: "Not found." };
  try {
    await createRepos(auth.supabase).courses.setItemStatus(kind, id, option);
  } catch (error) {
    return { error: describe(asDbError(error), "change its setting") };
  }
  revalidate(courseId);
  return { id };
}

async function setThumbnailImpl(auth: Auth, courseId: string, lessonId: string, assetId: string | null): Promise<OutlineResult> {
  if (!isId(courseId, "crs") || !isId(lessonId, "les") || (assetId !== null && !isId(assetId, "media"))) return { error: "Not found." };
  const repos = createRepos(auth.supabase);
  try {
    if (assetId !== null) {
      // An image that is in the library and not deleted: a made-up id would only fail on the foreign key, with a worse message.
      const asset = await repos.media.byId(assetId);
      if (!asset || asset.deleted_at) return { error: "That image isn't in the library any more. Choose another." };
    }
    if (!(await repos.courses.setLessonThumbnail({ id: lessonId, courseId }, assetId))) return { error: NOT_EDITABLE };
  } catch (error) {
    return { error: describe(asDbError(error), "set the thumbnail") };
  }
  revalidate(courseId);
  return { id: lessonId };
}

async function moveLessonImpl(auth: Auth, courseId: string, lessonId: string, moduleId: string | null): Promise<OutlineResult> {
  if (!isId(courseId, "crs") || !isId(lessonId, "les") || (moduleId !== null && !isId(moduleId, "mod"))) return { error: "Not found." };
  const courses = createRepos(auth.supabase).courses;
  try {
    // The lesson must be one of this course's, so a made-up course id can't be used to reach another's.
    const lesson = await courses.lessonById(lessonId);
    if (!lesson || lesson.course_id !== courseId) return { error: NOT_EDITABLE };
    await courses.moveLesson(lessonId, moduleId);
  } catch (error) {
    if (error instanceof Error && error.message === "module_not_found") return { error: "That module isn't in this course. Refresh the page." };
    return { error: describe(asDbError(error), "move it") };
  }
  revalidate(courseId);
  return { id: lessonId };
}

// Usage analytics: each action records whether it worked (lib/analytics/server.ts).
export async function addCourseModule(courseId: string, parentModuleId: string | null, title: string): Promise<OutlineResult> {
  const auth = await requireAdminAction();
  if (!auth.ok) return { error: auth.error };
  return withAction("course_module_added", () => addModuleImpl(auth, courseId, parentModuleId, title));
}

export async function addCourseLesson(courseId: string, moduleId: string, title: string): Promise<OutlineResult> {
  const auth = await requireAdminAction();
  if (!auth.ok) return { error: auth.error };
  return withAction("course_lesson_added", () => addLessonImpl(auth, courseId, moduleId, title));
}

export async function renameCourseItem(courseId: string, kind: ItemKind, id: string, title: string): Promise<OutlineResult> {
  const auth = await requireAdminAction();
  if (!auth.ok) return { error: auth.error };
  return withAction("course_item_renamed", () => renameItemImpl(auth, courseId, kind, id, title));
}

export async function deleteCourseItem(courseId: string, kind: ItemKind, id: string): Promise<OutlineResult> {
  const auth = await requireAdminAction();
  if (!auth.ok) return { error: auth.error };
  return withAction("course_item_deleted", () => deleteItemImpl(auth, courseId, kind, id));
}

export async function duplicateCourseItem(courseId: string, kind: ItemKind, id: string): Promise<OutlineResult> {
  const auth = await requireAdminAction();
  if (!auth.ok) return { error: auth.error };
  return withAction("course_item_duplicated", () => duplicateItemImpl(auth, courseId, kind, id));
}

export async function reorderCourseItems(courseId: string, kind: ItemKind, parentId: string | null, orderedIds: string[]): Promise<OutlineResult> {
  const auth = await requireAdminAction();
  if (!auth.ok) return { error: auth.error };
  return withAction("course_items_reordered", () => reorderItemsImpl(auth, courseId, kind, parentId, orderedIds));
}

/** A Hub-owned lesson's text, as HTML from the editor; it is cleaned to the lesson allowlist before it is stored. */
export async function saveLessonText(courseId: string, lessonId: string, html: string): Promise<OutlineResult> {
  const auth = await requireAdminAction();
  if (!auth.ok) return { error: auth.error };
  return withAction("course_lesson_text_saved", () => saveLessonTextImpl(auth, courseId, lessonId, html));
}

/** Sets a Hub-owned lesson's thumbnail to a library image (null: none). */
export async function setLessonThumbnail(courseId: string, lessonId: string, assetId: string | null): Promise<OutlineResult> {
  const auth = await requireAdminAction();
  if (!auth.ok) return { error: auth.error };
  return withAction("course_lesson_thumbnail_set", () => setThumbnailImpl(auth, courseId, lessonId, assetId));
}

/** Moves a Hub-owned lesson to the end of another module (null: out of every module). */
export async function moveCourseLesson(courseId: string, lessonId: string, moduleId: string | null): Promise<OutlineResult> {
  const auth = await requireAdminAction();
  if (!auth.ok) return { error: auth.error };
  return withAction("course_lesson_moved", () => moveLessonImpl(auth, courseId, lessonId, moduleId));
}

/** A module's or lesson's own setting: draft, published or locked. */
export async function setCourseItemStatus(courseId: string, kind: ItemKind, id: string, option: string): Promise<OutlineResult> {
  const auth = await requireAdminAction();
  if (!auth.ok) return { error: auth.error };
  return withAction("course_item_status_set", () => setItemStatusImpl(auth, courseId, kind, id, option));
}
