"use server";

import { revalidatePath } from "next/cache";
import { requireActionPermission } from "@/lib/admin-auth";
import { withAction } from "@/lib/analytics/server";
import { CourseWriteError } from "@/lib/data/courses";
import { createRepos } from "@/lib/data/repos";
import { isId } from "@/lib/ids";

/**
 * Delete a course: a Hub-owned draft that no member uses, with its modules and lessons. A single database call that checks and
 * deletes together, so it happens completely or not at all, run as the signed-in admin so the audit log names them: one entry,
 * for the course. The stored files and the videos and images (which a copy may share) are not touched. The rules are in
 * `delete_course` (migration 20271123000000) and, as the explanation beside the menu item, `src/lib/courses/blocked-reasons.ts`.
 */

export type DeleteResult = { error?: string; ok?: true };

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

type Auth = Extract<Awaited<ReturnType<typeof requireActionPermission>>, { ok: true }>;

/** What to tell staff for each reason the database refuses with. */
const REFUSALS: Record<string, string> = {
  not_found: "Course not found.",
  not_editable: "You can't delete this course.",
  not_deletable: "This course comes from Kajabi, and the next import would bring it back. Remove it in Kajabi, then import again.",
  published: "This course is published. Unpublish it first.",
  has_members: "Members have access to this course or are due access, so it can't be deleted.",
  has_activity: "Members have progress or comments on this course, which would be lost.",
};

async function deleteImpl(auth: Auth, courseId: string): Promise<DeleteResult> {
  if (!isId(courseId, "crs")) return { error: REFUSALS.not_found };

  try {
    await createRepos(auth.supabase).courses.deleteCourse(courseId);
  } catch (error) {
    const message = messageOf(error);
    if (message in REFUSALS) return { error: REFUSALS[message] };
    if (error instanceof CourseWriteError && error.code === "42501") return { error: REFUSALS.not_editable };
    console.error("course delete failed:", message);
    return { error: "Couldn't delete the course." };
  }
  revalidatePath("/admin/courses");
  return { ok: true };
}

// Usage analytics: each action records whether it worked (src/lib/analytics/server.ts).
/** Deletes a course nobody uses (a Hub-owned draft), with its modules and lessons. */
export async function deleteCourse(courseId: string): Promise<DeleteResult> {
  const auth = await requireActionPermission("courses.manage");
  if (!auth.ok) return { error: auth.error };
  return withAction("course_deleted", () => deleteImpl(auth, courseId));
}
