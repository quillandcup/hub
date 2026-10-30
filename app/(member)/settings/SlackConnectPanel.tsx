"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { disconnectSlackAction } from "./slackConnectActions";

const FLASH: Record<string, { ok: boolean; text: string }> = {
  connected: { ok: true, text: "Your Slack account is connected." },
  declined: { ok: false, text: "Slack didn't get your approval, so nothing was connected." },
  wrong_workspace: { ok: false, text: "That Slack account is in a different workspace. Sign in to our Slack workspace and try again." },
  taken: { ok: false, text: "That Slack account is already connected to another member. Ask an admin for help." },
  other_account: { ok: false, text: "You already connected a different Slack account. Disconnect it first, or ask an admin for help." },
  required: { ok: false, text: "Chat needs your Slack account connected. Connect it once and you are in." },
  invalid_state: { ok: false, text: "That link expired. Try connecting again." },
  failed: { ok: false, text: "Couldn't connect to Slack. Try again in a moment." },
  sudo: { ok: false, text: "You can't connect Slack while viewing as another member." },
  unavailable: { ok: false, text: "Connecting Slack isn't available yet." },
  no_member: { ok: false, text: "You need a member profile to connect Slack." },
};

/**
 * "Connect your Slack account" (Settings → Account, for everyone once the Slack app is configured). Hub chat
 * requires it: the Hub posts your messages and reactions to Slack as you, with your own token, and has no
 * fallback; without a connection chat stays closed. Connected with the read scopes, what you read in Hub chat
 * and in Slack is read in both; a connection from before that asks to reconnect. Links to the privacy page
 * (who can read what you write) when it is on for the member.
 */
export default function SlackConnectPanel({
  connected,
  sharesReadState = true,
}: {
  connected: boolean;
  sharesReadState?: boolean;
}) {
  const router = useRouter();
  const flash = FLASH[useSearchParams().get("slack") ?? ""];
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <section aria-labelledby="slack-connect-heading">
      <h2 id="slack-connect-heading" className="text-lg font-medium text-slate-900 dark:text-slate-100 mb-2">
        Slack
      </h2>
      {flash && (
        <p role="status" className={`mb-3 text-sm ${flash.ok ? "text-green-700 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
          {flash.text}
        </p>
      )}
      {connected ? (
        <>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Your Slack account is connected. Messages and reactions you send in Hub chat appear in Slack as you
            {sharesReadState ? ", and what you read in one place is marked read in the other." : "."}
          </p>
          {!sharesReadState && (
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
              To mark conversations read in both places, reconnect Slack once so it can share how far you have read.{" "}
              <a href="/api/oauth/slack/start" data-track="settings-slack-reconnect" className="font-medium text-plum-700 underline dark:text-plum-400">
                Reconnect Slack
              </a>
            </p>
          )}
          <button
            type="button"
            disabled={pending}
            data-track="settings-slack-disconnect"
            onClick={() =>
              startTransition(async () => {
                setError(null);
                const result = await disconnectSlackAction();
                if (result.ok) router.replace("/settings");
                else setError(result.error);
              })
            }
            className="mt-3 rounded-lg border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50 disabled:opacity-60 dark:border-slate-600 dark:hover:bg-slate-800"
          >
            {pending ? "Disconnecting…" : "Disconnect Slack"}
          </button>
          {error && (
            <p role="alert" className="mt-2 text-sm text-red-600 dark:text-red-400">
              {error}
            </p>
          )}
        </>
      ) : (
        <>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Hub chat needs your Slack account. Connect it and your messages and reactions appear in Slack as you, and what you
            read in one place is marked read in the other. You can disconnect any time, but chat stays closed until you reconnect.
          </p>
          {/* A full navigation: this goes to Slack and comes back through the callback route. */}
          <a data-track="settings-slack-connect-slack"
            href="/api/oauth/slack/start"
            className="mt-3 inline-block rounded-lg bg-plum-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-plum-700"
          >
            Connect Slack
          </a>
        </>
      )}
      <p className="mt-3 text-sm text-slate-600 dark:text-slate-400">
        Wondering who can read what you write?{" "}
        <Link data-track="settings-slack-privacy" href="/privacy" className="font-medium text-plum-700 underline dark:text-plum-400">
          See what staff can and can&apos;t see
        </Link>
        .
      </p>
    </section>
  );
}
