"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import Link from "next/link";
import { resendPendingInvite } from "./actions";

const LAST_EMAIL_KEY = "hedgiehub:lastEmail";

export default function LoginForm() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

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

  const handleEmailChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setEmail(value);
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
      if (error) throw error;

      setMessage({
        type: "success",
        text: "Check your email for the magic link!",
      });
      setEmail("");
    } catch (error: any) {
      setMessage({
        type: "error",
        text: error.message || "Something went wrong",
      });
    } finally {
      setLoading(false);
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

          <div className="mt-6 pt-6 border-t border-slate-200 dark:border-slate-700">
            <p className="text-sm text-slate-600 dark:text-slate-400 text-center">
              We'll email you a magic link for a password-free sign in.
            </p>
          </div>
        </div>

        <div className="mt-6 text-center">
          <Link href="/" className="text-sm text-plum-600 hover:text-plum-700 dark:text-plum-400 dark:hover:text-plum-300">
            ← Back to home
          </Link>
        </div>
      </div>
    </div>
  );
}
