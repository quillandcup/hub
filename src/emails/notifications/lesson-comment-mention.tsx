import * as React from "react";
import { NotificationEmail, type NotificationEmailProps } from "./NotificationEmail";

export function LessonCommentMentionEmail(props: NotificationEmailProps) {
  return (
    <NotificationEmail
      {...props}
      intro="The comment itself isn't in this email. Open it to read it and answer."
      buttonLabel="Open the comment"
    />
  );
}

export default LessonCommentMentionEmail;
