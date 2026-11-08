import { APP_URL } from "@/lib/config";
import type { Repos } from "@/lib/data/repos";

/** The address of a course lesson's page: the lesson route takes the course's slug and the lesson's id. */
export const lessonPath = (courseSlug: string, lessonId: string) => `/courses/${courseSlug}/lessons/${lessonId}`;

/**
 * The link to put in Slack for a message that shares a lesson video, or null when it shares none (or the lesson is
 * gone). Slack can't play the video or report plays: the link opens the lesson in the Hub, which asks them to sign in
 * and checks their course access like any visit. It never carries a playback link or a Mux id.
 */
export async function sharedVideoLink(repos: Pick<Repos, "chatVideos" | "courses">, messageId: string): Promise<string | null> {
  const lessonId = (await repos.chatVideos.lessonIdsOf([messageId])).get(messageId);
  if (!lessonId) return null;
  const lesson = await repos.courses.lessonById(lessonId);
  const course = lesson ? await repos.courses.courseById(lesson.course_id) : null;
  return course ? `${APP_URL}${lessonPath(course.slug, lessonId)}` : null;
}

/** The line `sendChatMessageToSlack` adds for a shared video; Slack's echo of the message brings it back into the Hub's copy. */
const SLACK_LINK_LINE = /\n<https?:\/\/[^|>\s]*\/courses\/[^|>\s/]+\/lessons\/[^|>\s/]+\|Watch the video>\s*$/;

/** `body` without the trailing Slack link line, for a message that shares a video (the card replaces it). */
export const stripSharedVideoLink = (body: string) => body.replace(SLACK_LINK_LINE, "");
