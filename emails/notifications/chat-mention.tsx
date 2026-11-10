import * as React from "react";
import { NotificationEmail, type NotificationEmailProps } from "./NotificationEmail";

export function ChatMentionEmail(props: NotificationEmailProps) {
  return (
    <NotificationEmail
      {...props}
      intro="The message itself isn't in this email. Open the conversation to read it and reply."
      buttonLabel="Open the conversation"
    />
  );
}

export default ChatMentionEmail;
