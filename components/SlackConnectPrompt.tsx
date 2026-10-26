"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

const DISMISSED_KEY = "slack-connect-prompt-dismissed";

export type SlackConnectNeed = "connect" | "reconnect" | "update";

const COPY: Record<SlackConnectNeed, { text: string; action: string }> = {
  connect: { text: "Hub chat needs your Slack account, so your messages and reactions come from you.", action: "Connect Slack" },
  reconnect: { text: "Your Slack connection stopped working, so chat is closed until you reconnect it.", action: "Reconnect Slack" },
  update: { text: "Chat needs you to reconnect Slack once, to give the Hub the permissions it asks for now.", action: "Reconnect Slack" },
};

/**
 * A bar across the member area for a member who has chat but not a working Slack connection (never connected,
 * one Slack stopped honouring, or one made before the Hub asked for what it needs now). It is the only way they
 * learn why chat is closed before running into it; the chat pages send them to Settings for the same reason.
 * Dismissed for the session, not shown in Settings (its panel says the same with the button).
 */
export default function SlackConnectPrompt({ need }: { need: SlackConnectNeed }) {
  const pathname = usePathname();
  // Hidden until read: sessionStorage doesn't exist on the server, so the first paint can't know.
  const [dismissed, setDismissed] = useState(true);
  useEffect(() => {
    setDismissed(sessionStorage.getItem(DISMISSED_KEY) === "1");
  }, []);

  if (dismissed || pathname.startsWith("/settings")) return null;
  const { text, action } = COPY[need];
  return (
    <div role="region" aria-label="Slack connection" className="flex flex-wrap items-center gap-x-4 gap-y-1 bg-plum-50 px-6 py-2 text-sm text-plum-900 dark:bg-slate-800 dark:text-slate-100">
      <p className="flex-1">{text}</p>
      {/* A full navigation: this goes to Slack and comes back through the callback route. */}
      <a data-track="slack-connect-prompt-connect" href="/api/oauth/slack/start" className="rounded-lg bg-plum-600 px-3 py-1 font-medium text-white hover:bg-plum-700">
        {action}
      </a>
      <button
        type="button"
        data-track="slack-connect-prompt-dismiss"
        onClick={() => {
          sessionStorage.setItem(DISMISSED_KEY, "1");
          setDismissed(true);
        }}
        className="text-plum-800 underline-offset-2 hover:underline dark:text-slate-300"
      >
        Not now
      </button>
    </div>
  );
}
