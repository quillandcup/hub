import * as React from "react";
import { NotificationEmail, type NotificationEmailProps } from "./NotificationEmail";

export function BookVisibilityNoticeEmail(props: NotificationEmailProps) {
  return <NotificationEmail {...props} intro={props.text} buttonLabel="Choose who sees your books" />;
}

export default BookVisibilityNoticeEmail;
