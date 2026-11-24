"use server";

import { revalidatePath } from "next/cache";
import { requireActionPermission } from "@/lib/admin-auth";
import { withAction } from "@/lib/analytics/server";
import { CourseWriteError } from "@/lib/data/courses";
import { createRepos } from "@/lib/data/repos";
import { isId } from "@/lib/ids";
import { duplicateBlockedByQuizzes } from "@/lib/courses/quiz-duplicate";

/**
 * Duplicate a course: a new draft course the Hub owns, with a copy of its modules and lessons (so the editor can be
 * tried on it while the original stays linked to Kajabi). A single database call, so it happens completely or not at
 * all, run as the signed-in admin so the audit log names them: one entry, for the new course. See
 * `src/lib/courses/duplicate.ts` for what it copies.
 */

export type DuplicateResult = { error?: string; id?: string };

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

type Auth = Extract<Awaited<ReturnType<typeof requireActionPermission>>, { ok: true }>;

async function duplicateImpl(auth: Auth, courseId: string): Promise<DuplicateResult> {
  if (!isId(courseId, "crs")) return { error: "Course not found." };

  let id: string;
  try {
    const repos = createRepos(auth.supabase);
    // The copy functions don't carry a quiz yet, so a course that holds one is refused (docs/TODO.md).
    const lessons = await repos.courses.lessonsOf([courseId], { includeHidden: true });
    const blocked = await duplicateBlockedByQuizzes(repos, lessons.map((l) => l.id), "course");
    if (blocked) return { error: blocked };
    id = await repos.courses.duplicateCourse(courseId);
  } catch (error) {
    const message = messageOf(error);
    if (message === "not_found") return { error: "Course not found." };
    if (message === "not_editable" || (error instanceof CourseWriteError && error.code === "42501")) return { error: "You can't copy this course." };
    if (message === "too_deep") return { error: "That course has modules nested deeper than the editor handles (a module has submodules, and a submodule has lessons), so it can't be copied." };
    console.error("course duplicate failed:", message);
    return { error: "Couldn't copy the course." };
  }
  revalidatePath("/admin/courses");
  return { id };
}

// Usage analytics: each action records whether it worked (src/lib/analytics/server.ts).
/** Copies a course into a new draft course the Hub owns, and returns the new course's id. */
export async function duplicateCourse(courseId: string): Promise<DuplicateResult> {
  const auth = await requireActionPermission("courses.manage");
  if (!auth.ok) return { error: auth.error };
  return withAction("course_duplicated", () => duplicateImpl(auth, courseId));
}
