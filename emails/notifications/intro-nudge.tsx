import * as React from "react";
import { NotificationEmail, type NotificationEmailProps } from "./NotificationEmail";

export function IntroNudgeEmail(props: NotificationEmailProps) {
  return (
    <NotificationEmail
      {...props}
      intro="A few lines about what you write and what you're working on is plenty. It's the easiest way to meet other Hedgies, and they love saying hello."
      buttonLabel="Introduce yourself"
    />
  );
}

export default IntroNudgeEmail;
