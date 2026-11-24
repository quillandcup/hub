import * as React from "react";
import { render } from "react-email";
import { postalAddress } from "@/lib/config";
import type { NotificationKindId } from "@/lib/notifications/registry";
import type { NotificationEmailProps } from "./NotificationEmail";
import { PrickleCheckinEmail } from "./prickle-checkin";
import { PrickleCheckoutEmail } from "./prickle-checkout";
import { IntroNudgeEmail } from "./intro-nudge";
import { PrickleNudgeEmail } from "./prickle-nudge";
import { BigSisterMatchEmail } from "./big-sister-match";
import { BookVisibilityNoticeEmail } from "./book-visibility-notice";
import { ChangelogDigestEmail } from "./changelog-digest";
import { ChatDmEmail } from "./chat-dm";
import { ChatMentionEmail } from "./chat-mention";
import { ChatChannelMessageEmail } from "./chat-channel-message";
import { LessonCommentReplyEmail } from "./lesson-comment-reply";
import { LessonCommentInstructorReplyEmail } from "./lesson-comment-instructor-reply";
import { LessonCommentMentionEmail } from "./lesson-comment-mention";
import { LessonCommentActivityEmail } from "./lesson-comment-activity";
import { LessonCommentModerationEmail } from "./lesson-comment-moderation";

/**
 * One template per notification kind, as React Email components. Member notification emails are
 * rendered when they're sent (renderNotificationEmail, below) rather than ahead of time and pushed
 * to Supabase: Supabase's email templates are only for its own auth emails (sign-in links, invites;
 * supabase/emails/ -> supabase/templates/, pushed with the config), and its mailer can't send
 * anything else. Both share the layout in supabase/emails/layout.tsx.
 *
 * Adding a kind to src/lib/notifications/registry.ts needs a template here; TypeScript enforces it.
 */
const TEMPLATES = {
  prickle_checkin: PrickleCheckinEmail,
  prickle_checkout: PrickleCheckoutEmail,
  intro_nudge: IntroNudgeEmail,
  prickle_nudge: PrickleNudgeEmail,
  big_sister_match: BigSisterMatchEmail,
  changelog_digest: ChangelogDigestEmail,
  book_visibility_notice: BookVisibilityNoticeEmail,
  chat_dm: ChatDmEmail,
  chat_mention: ChatMentionEmail,
  chat_channel_message: ChatChannelMessageEmail,
  lesson_comment_reply: LessonCommentReplyEmail,
  lesson_comment_instructor_reply: LessonCommentInstructorReplyEmail,
  lesson_comment_mention: LessonCommentMentionEmail,
  lesson_comment_activity: LessonCommentActivityEmail,
  lesson_comment_moderation: LessonCommentModerationEmail,
} satisfies Record<NotificationKindId, (props: NotificationEmailProps) => React.ReactElement>;

export interface RenderedNotificationEmail {
  subject: string;
  html: string;
  text: string;
}

export async function renderNotificationEmail(
  kind: NotificationKindId,
  props: Omit<NotificationEmailProps, "postalAddress">
): Promise<RenderedNotificationEmail> {
  // Every notification email carries our postal address (CAN-SPAM), added here so no caller can leave it out.
  const element = React.createElement(TEMPLATES[kind], { ...props, postalAddress: postalAddress() });
  const [html, text] = await Promise.all([render(element), render(element, { plainText: true })]);
  return { subject: props.title ?? props.text, html, text };
}
