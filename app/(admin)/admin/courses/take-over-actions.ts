"use server";

import { revalidatePath } from "next/cache";
import { requireAdminAction } from "@/lib/admin-auth";
import { withAction } from "@/lib/analytics/server";
import { CourseWriteError } from "@/lib/data/courses";
import { createRepos } from "@/lib/data/repos";
import { isId } from "@/lib/ids";

/**
 * Take a course over from Kajabi: it becomes a course the Hub owns (one way), and the Kajabi import skips it from
 * then on. A single database call, so it happens completely or not at all, run as the signed-in admin so the audit
 * log names them: one entry, for the course. See `lib/courses/take-over.ts` for what it changes.
 */

export type TakeOverResult = { error?: string; id?: string };

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

type Auth = Extract<Awaited<ReturnType<typeof requireAdminAction>>, { ok: true }>;

async function takeOverImpl(auth: Auth, courseId: string): Promise<TakeOverResult> {
  if (!isId(courseId, "crs")) return { error: "Course not found." };

  try {
    await createRepos(auth.supabase).courses.takeOverCourse(courseId);
  } catch (error) {
    const message = messageOf(error);
    if (message === "not_found") return { error: "Course not found." };
    if (message === "not_editable" || (error instanceof CourseWriteError && error.code === "42501")) return { error: "That course isn't one imported from Kajabi, so there is nothing to take over." };
    if (message === "too_deep") return { error: "That course has modules nested deeper than the editor handles (a module has submodules, and a submodule has lessons). Flatten it in Kajabi first." };
    console.error("course take-over failed:", message);
    return { error: "Couldn't take the course over." };
  }
  revalidatePath("/admin/courses");
  revalidatePath(`/admin/courses/${courseId}`);
  revalidatePath("/courses", "layout");
  return { id: courseId };
}

// Usage analytics: each action records whether it worked (lib/analytics/server.ts).
/** Turns a course imported from Kajabi into one the Hub owns. */
export async function takeOverCourse(courseId: string): Promise<TakeOverResult> {
  const auth = await requireAdminAction();
  if (!auth.ok) return { error: auth.error };
  return withAction("course_taken_over", () => takeOverImpl(auth, courseId));
}
