import * as React from "react";
import { NotificationEmail, type NotificationEmailProps } from "./NotificationEmail";

export function PrickleCheckoutEmail(props: NotificationEmailProps) {
  return (
    <NotificationEmail
      {...props}
      intro="Tell us how the prickle went and log your progress toward your goals."
      buttonLabel="Check out"
    />
  );
}

export default PrickleCheckoutEmail;
