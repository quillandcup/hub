import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getEffectiveIdentity, type EffectiveIdentity } from "@/lib/sudo";
import { effectiveMemberHasFeature, getUserFeaturePreviews } from "@/lib/features.server";
import { createClient } from "@/lib/supabase/server";
import type { MemberScope } from "@/lib/courses/member";

export interface CoursesCaller {
  userId: string;
  identity: EffectiveIdentity;
  /** What the course queries are scoped to: the effective member, and whether staff acting as themselves see every course. */
  scope: MemberScope;
}

/**
 * Who is using the courses feature, or null (signed out, no member record, or `courses` off for
 * them). Server actions use this directly, since they answer "nothing" instead of redirecting;
 * pages use `requireCoursesPage`.
 *
 * Staff open every course, but only as themselves: in sudo the effective member's own access
 * applies, so an admin previewing as a member sees exactly what that member would.
 */
export async function getCoursesCaller(): Promise<CoursesCaller | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  const supabase = await createClient();
  const [identity, ownFeatures, profile] = await Promise.all([
    getEffectiveIdentity(user),
    getUserFeaturePreviews(user.id),
    supabase.from("user_profiles").select("role").eq("id", user.id).single(),
  ]);
  if (!identity) return null;
  if (!(await effectiveMemberHasFeature("courses", identity, ownFeatures))) return null;
  const isAdmin = profile.data?.role === "admin";
  return {
    userId: user.id,
    identity,
    scope: { memberId: identity.memberId, isAdminActing: isAdmin && !identity.isSudo },
  };
}

/** For pages: the same check, with the usual redirects. */
export async function requireCoursesPage(): Promise<CoursesCaller> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const identity = await getEffectiveIdentity(user);
  if (!identity) redirect("/admin");
  const caller = await getCoursesCaller();
  if (!caller) redirect("/dashboard");
  return caller;
}
