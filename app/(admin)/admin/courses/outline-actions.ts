"use server";

import { revalidatePath } from "next/cache";
import { requireAdminAction } from "@/lib/admin-auth";
import { withAction } from "@/lib/analytics/server";
import { isId } from "@/lib/ids";
import { parseItemTitle } from "@/lib/courses/editor";

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
const TABLE = { module: "course_modules", lesson: "course_lessons" } as const;
const MAX_REORDER = 500;
const NOT_EDITABLE = "That course can't be edited here: it isn't in the Hub, or it's imported from Kajabi.";

type DbError = { code?: string; message: string };

/** What a database refusal means for the person editing, in their words. */
function describe(error: DbError, what: string): string {
  if (error.code === "42501") return NOT_EDITABLE;
  if (error.message === "stale_order") return "The outline changed since you opened it. Refresh the page and try again.";
  if (error.message === "not_editable") return NOT_EDITABLE;
  if (error.message === "not_found") return "That has been deleted. Refresh the page.";
  if (error.code === "23514" || error.code === "23503") return error.message.startsWith("A ") ? error.message : "That doesn't fit there.";
  console.error(`course outline: ${what} failed:`, error.message);
  return `Couldn't ${what}.`;
}

function revalidate(courseId: string) {
  revalidatePath(`/admin/courses/${courseId}`);
  revalidatePath("/courses", "layout");
}

/** The next position after the last of the siblings, so an added item goes at the end. */
async function nextPosition(auth: Auth, kind: ItemKind, courseId: string, parentId: string | null): Promise<number> {
  if (kind === "module") {
    const query = auth.supabase.from("course_modules").select("position").eq("course_id", courseId);
    const { data } = await (parentId ? query.eq("parent_id", parentId) : query.is("parent_id", null)).order("position", { ascending: false }).limit(1);
    return (data?.[0]?.position ?? 0) + 1;
  }
  const query = auth.supabase.from("course_lessons").select("position").eq("course_id", courseId);
  const { data } = await (parentId ? query.eq("module_id", parentId) : query.is("module_id", null)).order("position", { ascending: false }).limit(1);
  return (data?.[0]?.position ?? 0) + 1;
}

async function addModuleImpl(auth: Auth, courseId: string, parentModuleId: string | null, title: string): Promise<OutlineResult> {
  if (!isId(courseId, "crs") || (parentModuleId !== null && !isId(parentModuleId, "mod"))) return { error: "Course not found." };
  const name = parseItemTitle(title);
  if (!name.ok) return { error: name.error };

  const position = await nextPosition(auth, "module", courseId, parentModuleId);
  const { data, error } = await auth.supabase
    .from("course_modules")
    .insert({ course_id: courseId, parent_id: parentModuleId, title: name.title, position, state: "hidden", source: "hub" })
    .select("id")
    .single();
  if (error) return { error: describe(error, "add the module") };
  revalidate(courseId);
  return { id: data.id };
}

async function addLessonImpl(auth: Auth, courseId: string, moduleId: string, title: string): Promise<OutlineResult> {
  if (!isId(courseId, "crs") || !isId(moduleId, "mod")) return { error: "Course not found." };
  const name = parseItemTitle(title);
  if (!name.ok) return { error: name.error };

  const position = await nextPosition(auth, "lesson", courseId, moduleId);
  const { data, error } = await auth.supabase
    .from("course_lessons")
    .insert({ course_id: courseId, module_id: moduleId, title: name.title, position, state: "hidden", source: "hub" })
    .select("id")
    .single();
  if (error) return { error: describe(error, "add the lesson") };
  revalidate(courseId);
  return { id: data.id };
}

async function renameItemImpl(auth: Auth, courseId: string, kind: ItemKind, id: string, title: string): Promise<OutlineResult> {
  if (!isId(courseId, "crs") || !(kind in PREFIX) || !isId(id, PREFIX[kind])) return { error: "Not found." };
  const name = parseItemTitle(title);
  if (!name.ok) return { error: name.error };

  const { data, error } = await auth.supabase.from(TABLE[kind]).update({ title: name.title }).eq("id", id).eq("course_id", courseId).eq("source", "hub").select("id");
  if (error) return { error: describe(error, "rename it") };
  if (!data || data.length === 0) return { error: NOT_EDITABLE };
  revalidate(courseId);
  return { id };
}

/** The lessons that go with a module (its own and its submodules'), or the one lesson. */
async function lessonIdsUnder(auth: Auth, kind: ItemKind, id: string): Promise<string[]> {
  if (kind === "lesson") return [id];
  const { data: children } = await auth.supabase.from("course_modules").select("id").eq("parent_id", id);
  const moduleIds = [id, ...(children ?? []).map((c) => c.id)];
  const { data: lessons } = await auth.supabase.from("course_lessons").select("id").in("module_id", moduleIds);
  return (lessons ?? []).map((l) => l.id);
}

async function deleteItemImpl(auth: Auth, courseId: string, kind: ItemKind, id: string): Promise<OutlineResult> {
  if (!isId(courseId, "crs") || !(kind in PREFIX) || !isId(id, PREFIX[kind])) return { error: "Not found." };

  // A lesson members have worked through is theirs too: deleting it would erase their progress.
  const lessonIds = await lessonIdsUnder(auth, kind, id);
  if (lessonIds.length > 0) {
    const { count } = await auth.supabase.from("lesson_progress").select("lesson_id", { count: "exact", head: true }).in("lesson_id", lessonIds);
    if (count) return { error: `Members have progress in ${kind === "lesson" ? "this lesson" : "its lessons"}, so it can't be deleted. Hide it instead.` };
  }

  const { data, error } = await auth.supabase.from(TABLE[kind]).delete().eq("id", id).eq("course_id", courseId).eq("source", "hub").select("id");
  if (error) return { error: describe(error, "delete it") };
  if (!data || data.length === 0) return { error: NOT_EDITABLE };
  revalidate(courseId);
  return { id };
}

async function duplicateItemImpl(auth: Auth, courseId: string, kind: ItemKind, id: string): Promise<OutlineResult> {
  if (!isId(courseId, "crs") || !(kind in PREFIX) || !isId(id, PREFIX[kind])) return { error: "Not found." };
  const { data, error } =
    kind === "module" ? await auth.supabase.rpc("duplicate_course_module", { p_module_id: id }) : await auth.supabase.rpc("duplicate_course_lesson", { p_lesson_id: id });
  if (error) return { error: describe(error, "duplicate it") };
  revalidate(courseId);
  return { id: data as string };
}

async function reorderItemsImpl(auth: Auth, courseId: string, kind: ItemKind, parentId: string | null, orderedIds: string[]): Promise<OutlineResult> {
  if (!isId(courseId, "crs") || !(kind in PREFIX) || (parentId !== null && !isId(parentId, "mod"))) return { error: "Not found." };
  if (!Array.isArray(orderedIds) || orderedIds.length === 0 || orderedIds.length > MAX_REORDER || !orderedIds.every((id) => isId(id, PREFIX[kind]))) return { error: "Not found." };

  const { error } = await auth.supabase.rpc("reorder_course_children", { p_course_id: courseId, p_kind: kind, p_parent_id: parentId as string, p_ids: orderedIds });
  if (error) return { error: describe(error, "reorder them") };
  revalidate(courseId);
  return { id: courseId };
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
