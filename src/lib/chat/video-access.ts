import type { Repos } from "@/lib/data/repos";

/**
 * Whether a viewer who can read a message may watch the lesson video it shares. They may if they have the course; or, when an
 * admin shared it open to the channel, if the lesson is open to members and its course is published (a draft is no one's to
 * watch, and a lesson coming soon is not either). Used by both the playback route and the watch route, so they cannot disagree.
 */
export async function mayWatchSharedVideo(
  repos: Pick<Repos, "courses">,
  share: { openToChannel: boolean },
  lesson: { state: string; course_id: string },
  hasCourse: boolean,
): Promise<boolean> {
  if (hasCourse) return true;
  if (!share.openToChannel || lesson.state !== "open") return false;
  const course = await repos.courses.courseById(lesson.course_id);
  return Boolean(course && !course.is_draft);
}
