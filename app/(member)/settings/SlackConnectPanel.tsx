"use client";

import { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { disconnectSlackAction } from "./slackConnectActions";

const FLASH: Record<string, { ok: boolean; text: string }> = {
  connected: { ok: true, text: "Your Slack account is connected." },
  declined: { ok: false, text: "Slack didn't get your approval, so nothing was connected." },
  wrong_account: { ok: false, text: "That Slack account isn't the one matched to you. Sign in to your own Slack account and try again." },
  invalid_state: { ok: false, text: "That link expired. Try connecting again." },
  failed: { ok: false, text: "Couldn't connect to Slack. Try again in a moment." },
  sudo: { ok: false, text: "You can't connect Slack while viewing as another member." },
  unavailable: { ok: false, text: "Connecting Slack isn't available yet." },
  no_member: { ok: false, text: "You need a member profile to connect Slack." },
};

/**
 * "Connect your Slack account" (Settings → Account, behind the chat_posting preview). Connected, the
 * Hub posts your chat messages and reactions to Slack as you; without it, messages go through
 * Billie Bot under your name and reactions stay in the Hub.
 */
export default function SlackConnectPanel({ connected }: { connected: boolean }) {
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
            Your Slack account is connected. Messages and reactions you send in Hub chat appear in Slack as you.
          </p>
          <button
            type="button"
            disabled={pending}
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
            Connect your Slack account and your Hub chat messages and reactions appear in Slack as you, not as Billie Bot. Until
            then, your messages go through Billie Bot under your name and your reactions stay in the Hub. You can disconnect any time.
          </p>
          {/* A full navigation: this goes to Slack and comes back through the callback route. */}
          <a
            href="/api/oauth/slack/start"
            className="mt-3 inline-block rounded-lg bg-plum-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-plum-700"
          >
            Connect Slack
          </a>
        </>
      )}
    </section>
  );
}
