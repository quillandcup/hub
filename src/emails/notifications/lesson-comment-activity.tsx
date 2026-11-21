import * as React from "react";
import { NotificationEmail, type NotificationEmailProps } from "./NotificationEmail";

export function LessonCommentActivityEmail(props: NotificationEmailProps) {
  return (
    <NotificationEmail
      {...props}
      intro="You get this at most once a day, and only on days when a lesson you follow has new comments."
      buttonLabel="Read the comments"
    />
  );
}

export default LessonCommentActivityEmail;
