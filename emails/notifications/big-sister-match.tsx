import * as React from "react";
import { NotificationEmail, type NotificationEmailProps } from "./NotificationEmail";

export function BigSisterMatchEmail(props: NotificationEmailProps) {
  return (
    <NotificationEmail
      {...props}
      intro="Big Sisters are members who show new members around in their first weeks. Say hello, and ask or invite anything."
      buttonLabel="Meet them"
    />
  );
}

export default BigSisterMatchEmail;
