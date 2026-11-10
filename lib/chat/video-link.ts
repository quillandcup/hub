import { APP_URL } from "@/lib/config";
import type { Repos } from "@/lib/data/repos";
import { messagePermalink } from "@/lib/chat/focus";

/** The address of a course lesson's page: the lesson route takes the course's slug and the lesson's id. */
export const lessonPath = (courseSlug: string, lessonId: string) => `/courses/${courseSlug}/lessons/${lessonId}`;

/**
 * The address of a chat message in the Hub: its permalink (`lib/chat/focus.ts`), the conversation with `?m=<message>`. The server reads it,
 * so it survives sign-in, scrolls the list to the message however far back it is, and opens the thread of a reply. Same shape as the "Copy link"
 * on every message.
 */
export const chatMessagePath = (channelId: string, messageId: string) => messagePermalink(channelId, messageId);

const CHAT_LABEL = "Watch it in Hub Chat";
const LESSON_LABEL = "Open the lesson";

/**
 * The line to add to the Slack copy of a message that shares a lesson video, or null when it shares none. Slack can't play the
 * video or report plays, so it points back to the Hub with two links: the message in Hub Chat, where anyone who may watch it
 * (the course, or a share an admin opened to the channel) can play it, and the lesson, for those with the course. Both ask
 * a visitor to sign in and check access like any visit; neither carries a playback link or a Mux id. Either link is left out
 * when its target can't be found (the conversation isn't known, the lesson or course is gone).
 */
export async function sharedVideoSlackLine(
  repos: Pick<Repos, "chat" | "chatVideos" | "courses">,
  messageId: string,
  slackChannelId: string | null,
): Promise<string | null> {
  const lessonId = (await repos.chatVideos.lessonIdsOf([messageId])).get(messageId);
  if (!lessonId) return null;
  const [hubChannelId, lesson] = await Promise.all([
    slackChannelId ? repos.chat.idBySlackChannel(slackChannelId) : Promise.resolve(null),
    repos.courses.lessonById(lessonId),
  ]);
  const course = lesson ? await repos.courses.courseById(lesson.course_id) : null;
  const links = [
    hubChannelId ? `<${APP_URL}${chatMessagePath(hubChannelId, messageId)}|${CHAT_LABEL}>` : null,
    course ? `<${APP_URL}${lessonPath(course.slug, lessonId)}|${LESSON_LABEL}>` : null,
  ].filter((l): l is string => l !== null);
  return links.length > 0 ? `\n${links.join(" · ")}` : null;
}

/**
 * The line above as Slack's copy of the message brings it back into the Hub, and the single link an earlier version added. The
 * Hub shows the card instead, so it is dropped from the text of a message that shares a video.
 */
// The permalink (?m=) and the two earlier shapes (?thread=, with or without #m-).
const CHAT_LINK = "<https?://[^|>\\s]*/chat/[^|>\\s/?]+\\?(?:m|thread)=msg_[^|>\\s]+\\|" + CHAT_LABEL + ">";
const LESSON_LINK = "<https?://[^|>\\s]*/courses/[^|>\\s/]+/lessons/[^|>\\s/]+\\|" + LESSON_LABEL + ">";
const FIRST_VERSION_LINK = "<https?://[^|>\\s]*/courses/[^|>\\s/]+/lessons/[^|>\\s/]+\\|Watch the video>";
const SLACK_LINK_LINE = new RegExp(`(?:^|\\n)(?:${CHAT_LINK}(?: · ${LESSON_LINK})?|${LESSON_LINK}|${FIRST_VERSION_LINK})\\s*$`);

/** `body` without the trailing Slack link line (alone on the first line when the pasted address was the whole message), for a message that shares a video (the card replaces it). */
export const stripSharedVideoLink = (body: string) => body.replace(SLACK_LINK_LINE, "");
