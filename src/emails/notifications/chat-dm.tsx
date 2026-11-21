import * as React from "react";
import { NotificationEmail, type NotificationEmailProps } from "./NotificationEmail";

export function ChatDmEmail(props: NotificationEmailProps) {
  return (
    <NotificationEmail
      {...props}
      intro="The message itself isn't in this email: it stays in the Hub, where only you and the people in the conversation can read it."
      buttonLabel="Open the conversation"
    />
  );
}

export default ChatDmEmail;
