import * as React from "react";
import { NotificationEmail, type NotificationEmailProps } from "./NotificationEmail";

export function LessonCommentModerationEmail(props: NotificationEmailProps) {
  return (
    <NotificationEmail
      {...props}
      intro="Open the review queue to read each one and decide whether to hide it, delete it or let it stand."
      buttonLabel="Open the review queue"
    />
  );
}

export default LessonCommentModerationEmail;
