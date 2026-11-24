import { canOpenLessons, resolveCourseAccess } from "@/lib/courses/member";
import type { Repos } from "@/lib/data/repos";

/** Who can read a course's lesson comments, for the senders and for mentions (docs/product/COURSES.md, "Lesson comments"). */

/**
 * Of these members, who can open each course's lessons now: current access, or staff (who open every course). Ended or upcoming
 * access means no notification: the comments are closed to them. One read of the courses' access rows, however many members.
 */
export async function readersOf(repos: Repos, courseIds: string[], memberIds: string[], now: Date): Promise<Map<string, Set<string>>> {
  const wanted = new Set(memberIds);
  const [rows, staff] = await Promise.all([repos.courseProgress.accessOfCourses(courseIds), staffAmong(repos, memberIds)]);
  const readers = new Map<string, Set<string>>(courseIds.map((id) => [id, new Set<string>(staff)]));
  for (const row of rows) {
    if (!wanted.has(row.member_id)) continue;
    if (canOpenLessons(resolveCourseAccess(row, false, now))) readers.get(row.course_id)?.add(row.member_id);
  }
  return readers;
}

/** The admins among these members. */
export async function staffAmong(repos: Repos, memberIds: string[]): Promise<string[]> {
  if (memberIds.length === 0) return [];
  const [adminUserIds, userIds] = await Promise.all([repos.profiles.adminIds(), repos.members.userIdsByMemberId(memberIds)]);
  const admins = new Set(adminUserIds);
  return memberIds.filter((id) => {
    const userId = userIds.get(id);
    return Boolean(userId && admins.has(userId));
  });
}
