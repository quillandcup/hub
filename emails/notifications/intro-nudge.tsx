import * as React from "react";
import { NotificationEmail, type NotificationEmailProps } from "./NotificationEmail";

export function IntroNudgeEmail(props: NotificationEmailProps) {
  return (
    <NotificationEmail
      {...props}
      intro={props.text}
      buttonLabel="Introduce yourself"
    />
  );
}

export default IntroNudgeEmail;
