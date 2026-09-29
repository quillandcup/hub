import type { Metadata } from "next";
import Link from "next/link";
import { slackHomeDeepLink } from "@/lib/slack-sign-in";
import { completeSlackSignIn } from "../actions";

export const metadata: Metadata = {
  title: "Sign in from Slack",
  robots: { index: false, follow: false },
  // The URL can carry the one-time token; never leak it in a Referer header.
  referrer: "no-referrer",
};

const ERROR_MESSAGES: Record<string, string> = {
  expired: "This sign-in link has expired or was already used.",
  unavailable: "Signing in from Slack isn't available for this account. Please sign in by email instead.",
  failed: "Something went wrong signing you in. Please try again from Slack, or sign in by email.",
};

/**
 * Where Slack sign-in lands when it can't finish in one step (app/auth/slack/route.ts): a
 * "Continue" button when the click didn't look like a plain browser navigation, or a way back
 * into Slack when the link was expired or used. Rendering never spends the token.
 */
export default async function SlackSignInContinuePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; error?: string; refreshed?: string }>;
}) {
  const { token, error, refreshed } = await searchParams;
  const errorKey = error ? (error in ERROR_MESSAGES ? error : "failed") : !token ? "expired" : null;
  const slackHome = slackHomeDeepLink();

  return (
    <div className="min-h-screen bg-canvas dark:bg-slate-950 flex items-center justify-center px-6">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-plum-600 dark:text-plum-400 mb-2">Hedgie Hub</h1>
          <p className="text-slate-600 dark:text-slate-400">Signing in from Slack</p>
        </div>

        <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-lg p-8 space-y-6">
          {errorKey ? (
            <>
              <div className="p-4 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300">
                {ERROR_MESSAGES[errorKey]}
                {errorKey === "expired" &&
                  (refreshed
                    ? " We've put a fresh button in the Hedgie Hub app in Slack."
                    : " Open the Hedgie Hub app in Slack for a fresh one.")}
              </div>
              {errorKey === "expired" && slackHome && (
                <a
                  href={slackHome}
                  className="block w-full text-center px-6 py-3 bg-plum-600 hover:bg-plum-700 text-white font-semibold rounded-lg transition-colors"
                >
                  Open Hedgie Hub in Slack
                </a>
              )}
              <Link
                href="/login"
                className="block w-full text-center px-6 py-3 border border-plum-600 text-plum-700 dark:text-plum-300 font-semibold rounded-lg transition-colors hover:bg-plum-50 dark:hover:bg-slate-800"
              >
                Sign in by email
              </Link>
            </>
          ) : (
            <form action={completeSlackSignIn} className="space-y-4">
              <input type="hidden" name="token" value={token} />
              <button
                type="submit"
                className="w-full px-6 py-3 bg-plum-600 hover:bg-plum-700 text-white font-semibold rounded-lg transition-colors"
              >
                Continue to Hedgie Hub
              </button>
              <p className="text-sm text-slate-600 dark:text-slate-400 text-center">
                You&apos;re signing in with the Hedgie Hub app in Slack. This button works once.
              </p>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
