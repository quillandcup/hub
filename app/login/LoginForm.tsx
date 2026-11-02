"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import Link from "next/link";
import { resendPendingInvite, verifyEmailCode } from "./actions";
import SlackSignIn from "./SlackSignIn";

const LAST_EMAIL_KEY = "hedgiehub:lastEmail";

// How long the "you just asked for one" notice stays up: it only explains the one-minute wait
// between emails, so it clears itself rather than lingering after the wait is over.
const RATE_LIMIT_NOTICE_MS = 10_000;

const RATE_LIMITED_TEXT =
  "We just emailed you a link. Check your inbox (and spam), or try again in a minute.";

const CALLBACK_FAILED_TEXT =
  "That sign-in link didn't work. Links only work in the browser you asked from, and each works once. Enter the code from the email below, or request a new link.";

export default function LoginForm({
  slackHomeUrl,
  callbackFailed = false,
}: {
  slackHomeUrl: string | null;
  callbackFailed?: boolean;
}) {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(
    callbackFailed ? { type: "error", text: CALLBACK_FAILED_TEXT } : null
  );
  const [linkSent, setLinkSent] = useState(false);
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);

  const supabase = createClient();

  // Pre-fill the last-used email after mount so server-rendered and
  // first-client-rendered markup match (avoids a hydration mismatch).
  useEffect(() => {
    try {
      const lastEmail = window.localStorage.getItem(LAST_EMAIL_KEY);
      if (lastEmail) setEmail(lastEmail);
    } catch {
      // localStorage can throw (private browsing, disabled storage) — no-op.
    }
  }, []);

  useEffect(() => {
    if (message?.type !== "error" || message.text !== RATE_LIMITED_TEXT) return;
    const timer = window.setTimeout(() => setMessage(null), RATE_LIMIT_NOTICE_MS);
    return () => window.clearTimeout(timer);
  }, [message]);

  const handleEmailChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setEmail(value);
    setLinkSent(false);
    try {
      window.localStorage.setItem(LAST_EMAIL_KEY, value);
    } catch {
      // localStorage can throw (private browsing, disabled storage) — no-op.
    }
  };

  const handleMagicLink = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage(null);

    try {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback`,
        },
      });

      if (error?.code === "signup_disabled") {
        // No confirmed account for this email. If they were invited but never accepted
        // (e.g. the invite link expired), send them a fresh invitation instead.
        const { invited } = await resendPendingInvite(email);
        setMessage(
          invited
            ? {
                type: "success",
                text: "You've been invited but haven't accepted yet, so we've emailed you a fresh invitation. Click the link in it to sign in.",
              }
            : {
                type: "error",
                text: "We couldn't find a Hedgie Hub account for that email. Check the address, or ask us for an invite.",
              }
        );
        return;
      }
      if (error?.code === "over_email_send_rate_limit") {
        // Supabase allows one email per address a minute; a second click inside it lands here.
        setMessage({ type: "error", text: RATE_LIMITED_TEXT });
        return;
      }
      if (error) throw error;

      setMessage({
        type: "success",
        text: "Check your email for the magic link!",
      });
      setLinkSent(true);
      setCode("");
      setCodeError(null);
    } catch (error: any) {
      setMessage({
        type: "error",
        text: error.message || "Something went wrong",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setVerifying(true);
    setCodeError(null);
    try {
      // Redirects on success, so only a failure comes back.
      const result = await verifyEmailCode(email, code);
      if (result?.error) setCodeError(result.error);
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div className="min-h-screen bg-canvas dark:bg-slate-950 flex items-center justify-center px-6">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <Link href="/">
            <h1 className="text-3xl font-bold text-plum-600 dark:text-plum-400 mb-2">
              Hedgie Hub
            </h1>
          </Link>
          <p className="text-slate-600 dark:text-slate-400">Sign in to your account</p>
        </div>

        <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-lg p-8">
          <form onSubmit={handleMagicLink} className="space-y-6">
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                Email address
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={handleEmailChange}
                placeholder="you@example.com"
                required
                className="w-full px-4 py-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-plum-500"
              />
            </div>

            {message && (
              <div
                className={`p-4 rounded-lg ${
                  message.type === "success"
                    ? "bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300"
                    : "bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300"
                }`}
              >
                {message.text}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full px-6 py-3 bg-plum-600 hover:bg-plum-700 disabled:bg-plum-400 text-white font-semibold rounded-lg transition-colors"
            >
              {loading ? "Sending..." : "Send Magic Link"}
            </button>
          </form>

          {linkSent && (
            <form onSubmit={handleCode} className="mt-6 space-y-3">
              <label htmlFor="code" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                Link not opening here? Enter the code from the email
              </label>
              <input
                id="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="12345678"
                className="w-full px-4 py-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 tracking-widest focus:outline-none focus:ring-2 focus:ring-plum-500"
              />
              {codeError && <p className="text-sm text-red-700 dark:text-red-300">{codeError}</p>}
              <button
                type="submit"
                disabled={verifying || code.trim() === ""}
                className="w-full px-6 py-3 border border-plum-600 text-plum-700 dark:text-plum-300 hover:bg-plum-50 dark:hover:bg-slate-800 disabled:opacity-50 font-semibold rounded-lg transition-colors"
              >
                {verifying ? "Checking..." : "Sign in with code"}
              </button>
            </form>
          )}

          {/* Shown only once SLACK_TEAM_ID and SLACK_APP_ID are set, i.e. the Slack app is live. */}
          {slackHomeUrl && (
            <div className="mt-6">
              <div className="flex items-center gap-3 mb-6 text-sm text-slate-600 dark:text-slate-400">
                <span className="flex-1 border-t border-slate-200 dark:border-slate-700" />
                or
                <span className="flex-1 border-t border-slate-200 dark:border-slate-700" />
              </div>
              <SlackSignIn slackHomeUrl={slackHomeUrl} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
