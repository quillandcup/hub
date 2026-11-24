import type { Repos } from "@/lib/data/repos";

/**
 * A course's instructors (docs/product/COURSES.md, "Lesson comments"): the members whose lesson comments carry the Instructor
 * badge. The list is kept in `course_instructors`; the badge is a flag stored on each comment (`isInstructorReply`), set when it
 * is posted and by the Kajabi import, and set again here for the comments already there whenever a course's instructors change.
 */

/** The most instructors one course may have; a team, not a roster. */
export const MAX_COURSE_INSTRUCTORS = 20;

export type InstructorChange = {
  /** The members added and removed (the list was saved as asked; empty both ways when it already was). */
  added: string[];
  removed: string[];
  /** Comments whose badge changed with it. */
  recomputed: number;
};

/**
 * Makes `memberIds` the course's instructors and brings the badge on its existing comments in line. `writer` is the admin's own
 * repositories (the audit log names them: one entry for each instructor added or removed); `server` is on the service role, which
 * is what may update other members' comments. Safe to repeat: the comments are recomputed even when the list did not change, so a
 * save also repairs a flag that drifted.
 */
export async function saveCourseInstructors(writer: Pick<Repos, "courseInstructors">, server: Pick<Repos, "courseComments">, courseId: string, memberIds: string[]): Promise<InstructorChange> {
  const { added, removed } = await writer.courseInstructors.set(courseId, memberIds);
  const recomputed = await server.courseComments.reflagInstructors(courseId, [...new Set(memberIds)]);
  return { added, removed, recomputed };
}
