import * as React from "react";
import { NotificationEmail, type NotificationEmailProps } from "./NotificationEmail";

export function PrickleNudgeEmail(props: NotificationEmailProps) {
  return (
    <NotificationEmail
      {...props}
      intro={props.text}
      buttonLabel="Find a prickle"
    />
  );
}

export default PrickleNudgeEmail;
