import * as React from "react";
import { NotificationEmail, type NotificationEmailProps } from "./NotificationEmail";

export function PrickleNudgeEmail(props: NotificationEmailProps) {
  return (
    <NotificationEmail
      {...props}
      intro="A prickle is a focused writing session with other Hedgies. Pick one that fits your week and add it to your calendar. If you miss one, just pick another."
      buttonLabel="Find a prickle"
    />
  );
}

export default PrickleNudgeEmail;
