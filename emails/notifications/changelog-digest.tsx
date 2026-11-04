import * as React from "react";
import { NotificationEmail, type NotificationEmailProps } from "./NotificationEmail";

export function ChangelogDigestEmail(props: NotificationEmailProps) {
  return <NotificationEmail {...props} intro={props.text} buttonLabel="See what's new" />;
}

export default ChangelogDigestEmail;
