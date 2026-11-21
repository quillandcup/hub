import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { createRepos } from "@/lib/data/repos";
import { getEffectiveIdentity, type EffectiveIdentity } from "@/lib/sudo";
import { createClient } from "@/lib/supabase/server";
import type { MemberScope } from "@/lib/courses/member";

export interface CoursesCaller {
  userId: string;
  identity: EffectiveIdentity;
  /** What the course queries are scoped to: the effective member, and whether staff acting as themselves see every course. */
  scope: MemberScope;
}

/**
 * Who is using the courses feature, or null (signed out, or no member record). Server actions use this directly, since they answer "nothing" instead of redirecting;
 * pages use `requireCoursesPage`.
 *
 * Staff open every course, but only as themselves: in sudo the effective member's own access
 * applies, so an admin previewing as a member sees exactly what that member would.
 */
export async function getCoursesCaller(): Promise<CoursesCaller | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  const supabase = await createClient();
  const [identity, profile] = await Promise.all([
    getEffectiveIdentity(user),
    createRepos(supabase).profiles.isAdmin(user.id),
  ]);
  if (!identity) return null;
  const isAdmin = profile;
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
