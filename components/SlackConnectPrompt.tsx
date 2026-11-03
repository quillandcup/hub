"use client";

import { usePathname } from "next/navigation";
import AnnouncementBar from "@/components/announcements/AnnouncementBar";

const DISMISSED_KEY = "slack-connect-prompt-dismissed";

export type SlackConnectNeed = "connect" | "reconnect" | "update" | "permissions";

const COPY: Record<SlackConnectNeed, { text: string; action: string }> = {
  connect: { text: "Hub chat needs your Slack account, so your messages and reactions come from you.", action: "Connect Slack" },
  reconnect: { text: "Your Slack connection stopped working, so chat is closed until you reconnect it.", action: "Reconnect Slack" },
  update: { text: "Chat needs you to reconnect Slack once, to give the Hub the permissions it asks for now.", action: "Reconnect Slack" },
  permissions: { text: "Slack direct messages are coming to Hub chat. Reconnect Slack once now, or you won't be able to message people in the Hub when they arrive.", action: "Reconnect Slack" },
};

/**
 * A bar across the member area for a member who has chat but not a working Slack connection (never connected,
 * one Slack stopped honouring, or one made before the Hub asked for what it needs now, or for what it will need for direct messages). It is the only way they
 * learn why chat is closed before running into it; the chat pages send them to Settings for the same reason.
 * Dismissed for the session, not shown in Settings (its panel says the same with the button).
 */
export default function SlackConnectPrompt({ need }: { need: SlackConnectNeed }) {
  const pathname = usePathname();
  if (pathname.startsWith("/settings")) return null;
  const { text, action } = COPY[need];
  return (
    <AnnouncementBar
      tone="info"
      aria-label="Slack connection"
      // A full navigation: this goes to Slack and comes back through the callback route.
      action={{ label: action, track: "slack-connect-prompt-connect", href: "/api/oauth/slack/start", external: true }}
      dismiss={{ dismissKey: DISMISSED_KEY, scope: "session", track: "slack-connect-prompt-dismiss" }}
    >
      <p>{text}</p>
    </AnnouncementBar>
  );
}
