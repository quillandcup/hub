"use server";

import { revalidatePath } from "next/cache";
import { requireAdminAction } from "@/lib/admin-auth";
import { withAction } from "@/lib/analytics/server";
import { createRepos } from "@/lib/data/repos";
import { isId } from "@/lib/ids";
import { parseCourseDetails, type CourseDetails, type CourseDetailsErrors, type CourseDetailsInput } from "@/lib/courses/editor";

/**
 * The course editor's writes. Every one runs as the signed-in admin with their own client (not the
 * service role), so the database policies decide what they may touch (only Hub-owned courses, never
 * one imported from Kajabi) and the audit log records them by name (migration 20270315000000).
 */

type Auth = Extract<Awaited<ReturnType<typeof requireAdminAction>>, { ok: true }>;
export type CourseSaveResult = { error?: string; fieldErrors?: CourseDetailsErrors; id?: string };

const UNIQUE_VIOLATION = "23505";

/** The checks both actions share: the details are valid, and the program (when given) exists. */
async function checkedDetails(auth: Auth, input: CourseDetailsInput): Promise<{ value: CourseDetails } | { result: CourseSaveResult }> {
  const parsed = parseCourseDetails(input);
  if (!parsed.ok) return { result: { fieldErrors: parsed.errors } };
  if (parsed.value.program_id && !(await createRepos(auth.supabase).programs.byId(parsed.value.program_id))) {
    return { result: { fieldErrors: { programId: "That program doesn't exist." } } };
  }
  return { value: parsed.value };
}

function revalidate(id: string) {
  revalidatePath("/admin/courses");
  revalidatePath(`/admin/courses/${id}`);
  revalidatePath("/courses", "layout");
}

async function createCourseImpl(auth: Auth, input: CourseDetailsInput): Promise<CourseSaveResult> {
  const checked = await checkedDetails(auth, input);
  if ("result" in checked) return checked.result;

  const { data, error } = await auth.supabase.from("courses").insert({ ...checked.value, source: "hub", kind: "evergreen" }).select("id").single();
  if (error) {
    if (error.code === UNIQUE_VIOLATION) return { fieldErrors: { slug: "Another course already uses that address." } };
    console.error("course create failed:", error.message);
    return { error: "Couldn't create the course." };
  }
  revalidate(data.id);
  return { id: data.id };
}

async function updateCourseDetailsImpl(auth: Auth, courseId: string, input: CourseDetailsInput): Promise<CourseSaveResult> {
  if (!isId(courseId, "crs")) return { error: "Course not found." };
  const checked = await checkedDetails(auth, input);
  if ("result" in checked) return checked.result;

  // `source = 'hub'` is also what the database policy requires: a course imported from Kajabi matches no row here.
  const { data, error } = await auth.supabase.from("courses").update(checked.value).eq("id", courseId).eq("source", "hub").select("id");
  if (error) {
    if (error.code === UNIQUE_VIOLATION) return { fieldErrors: { slug: "Another course already uses that address." } };
    console.error("course update failed:", error.message);
    return { error: "Couldn't save the course." };
  }
  if (!data || data.length === 0) return { error: "That course can't be edited here: it isn't in the Hub, or it's imported from Kajabi." };
  revalidate(courseId);
  return { id: courseId };
}

// Usage analytics: each action records whether it worked (lib/analytics/server.ts). A form that came back with
// field errors didn't save, so it isn't counted as worked.
const saved = (result: CourseSaveResult) => ({ ok: !result.error && !result.fieldErrors });

export async function createCourse(input: CourseDetailsInput): Promise<CourseSaveResult> {
  const auth = await requireAdminAction();
  if (!auth.ok) return { error: auth.error };
  return withAction("course_created", () => createCourseImpl(auth, input), saved);
}

export async function updateCourseDetails(courseId: string, input: CourseDetailsInput): Promise<CourseSaveResult> {
  const auth = await requireAdminAction();
  if (!auth.ok) return { error: auth.error };
  return withAction("course_details_saved", () => updateCourseDetailsImpl(auth, courseId, input), saved);
}
