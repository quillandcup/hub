import * as React from "react";
import { NotificationEmail, type NotificationEmailProps } from "./NotificationEmail";

export function PrickleCheckinEmail(props: NotificationEmailProps) {
  return (
    <NotificationEmail
      {...props}
      intro="A quick check-in helps you notice how you're arriving, and it's only visible to you and the admins. It takes under a minute."
      buttonLabel="Check in"
    />
  );
}

export default PrickleCheckinEmail;
