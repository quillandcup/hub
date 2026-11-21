import * as React from "react";
import { NotificationEmail, type NotificationEmailProps } from "./NotificationEmail";

export function ChatChannelMessageEmail(props: NotificationEmailProps) {
  return (
    <NotificationEmail
      {...props}
      intro="You get this because you chose to hear about every message in this channel. You can change that with the bell at the top of the conversation."
      buttonLabel="Open the channel"
    />
  );
}

export default ChatChannelMessageEmail;
