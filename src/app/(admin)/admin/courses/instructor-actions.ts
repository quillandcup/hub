"use server";

import { revalidatePath } from "next/cache";
import { requireActionPermission } from "@/lib/admin-auth";
import { withAction } from "@/lib/analytics/server";
import { MAX_COURSE_INSTRUCTORS, saveCourseInstructors } from "@/lib/courses/instructors";
import { createRepos } from "@/lib/data/repos";
import { isId } from "@/lib/ids";
import { createServiceRoleClient } from "@/lib/supabase/service";

/**
 * A course's instructors: the members whose lesson comments carry the Instructor badge (docs/product/COURSES.md, "Lesson comments").
 * Saved as the signed-in admin, so the audit log names them (one entry for each instructor added or removed); the badge on the
 * comments already in the course's threads, imported ones included, is then recomputed with the service role, which is what may
 * update other members' comments.
 */

export type InstructorsResult = {
  error?: string;
  /** Instructors added and removed, and comments whose badge changed with them. */
  added?: number;
  removed?: number;
  recomputed?: number;
  /** For the shortcut: how many courses gained at least one instructor. */
  courses?: number;
};

type Auth = Extract<Awaited<ReturnType<typeof requireActionPermission>>, { ok: true }>;

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

function revalidate(courseId: string) {
  revalidatePath(`/admin/courses/${courseId}`, "layout");
  revalidatePath("/courses", "layout");
}

async function saveImpl(auth: Auth, courseId: string, memberIds: string[]): Promise<InstructorsResult> {
  if (!isId(courseId, "crs")) return { error: "Course not found." };
  if (!Array.isArray(memberIds) || !memberIds.every((id) => isId(id, "mbr"))) return { error: "Pick members from the list." };
  if (new Set(memberIds).size > MAX_COURSE_INSTRUCTORS) return { error: `A course can have up to ${MAX_COURSE_INSTRUCTORS} instructors.` };
  const repos = createRepos(auth.supabase);
  if (!(await repos.courses.courseById(courseId))) return { error: "Course not found." };
  try {
    const change = await saveCourseInstructors(repos, createRepos(createServiceRoleClient()), courseId, memberIds);
    revalidate(courseId);
    return { added: change.added.length, removed: change.removed.length, recomputed: change.recomputed };
  } catch (error) {
    console.error("course instructors save failed:", messageOf(error));
    return { error: "Couldn't save the instructors." };
  }
}

async function addToAllImpl(auth: Auth, courseId: string): Promise<InstructorsResult> {
  if (!isId(courseId, "crs")) return { error: "Course not found." };
  const repos = createRepos(auth.supabase);
  const server = createRepos(createServiceRoleClient());
  try {
    const source = await repos.courseInstructors.forCourse(courseId);
    if (source.length === 0) return { error: "Add an instructor to this course first." };
    let courses = 0;
    let recomputed = 0;
    // Each course keeps the instructors it has and gains these (a course already at the limit is left as it is).
    for (const course of await repos.courses.courses()) {
      const union = [...new Set([...(await repos.courseInstructors.forCourse(course.id)), ...source])];
      if (union.length > MAX_COURSE_INSTRUCTORS) continue;
      const change = await saveCourseInstructors(repos, server, course.id, union);
      if (change.added.length > 0) courses += 1;
      recomputed += change.recomputed;
      revalidate(course.id);
    }
    return { courses, recomputed };
  } catch (error) {
    console.error("course instructors copy failed:", messageOf(error));
    return { error: "Couldn't add the instructors to every course." };
  }
}

// Usage analytics: each action records whether it worked (src/lib/analytics/server.ts).
/** Makes these members the course's instructors (adding and removing as needed) and brings the badges on its comments in line. */
export async function saveCourseInstructorList(courseId: string, memberIds: string[]): Promise<InstructorsResult> {
  const auth = await requireActionPermission("courses.manage");
  if (!auth.ok) return { error: auth.error };
  return withAction("course_instructors_saved", () => saveImpl(auth, courseId, memberIds));
}

/** Adds this course's instructors to every other course too (nobody is removed anywhere), then recomputes each course's badges. */
export async function addInstructorsToAllCourses(courseId: string): Promise<InstructorsResult> {
  const auth = await requireActionPermission("courses.manage");
  if (!auth.ok) return { error: auth.error };
  return withAction("course_instructors_added_to_all", () => addToAllImpl(auth, courseId));
}
