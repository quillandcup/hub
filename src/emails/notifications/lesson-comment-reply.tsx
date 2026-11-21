import * as React from "react";
import { NotificationEmail, type NotificationEmailProps } from "./NotificationEmail";

export function LessonCommentReplyEmail(props: NotificationEmailProps) {
  return (
    <NotificationEmail
      {...props}
      intro="The reply itself isn't in this email. Open the comment to read it and answer."
      buttonLabel="Open the reply"
    />
  );
}

export default LessonCommentReplyEmail;
