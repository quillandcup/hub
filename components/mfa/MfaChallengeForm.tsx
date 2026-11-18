"use client";

import { useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import SignOutButton from "@/components/SignOutButton";
import { STAFF_MFA_FACTOR_TYPE } from "@/lib/staff-mfa";
import { MFA_CODE_LENGTH, cleanMfaCode } from "@/lib/mfa-code";

/**
 * The second step of signing in: type the code from the authenticator app. Passing it makes the session aal2 (the browser
 * client stores the new token), then a full navigation to `next` so the server sees it.
 * `helpEmail` is who to write to when the phone is lost (config, docs/STAFF_MFA.md has what they do).
 */
export default function MfaChallengeForm({ next, helpEmail }: { next: string; helpEmail: string }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { data: listed } = await supabase.auth.mfa.listFactors();
    const factor = listed?.totp[0];
    if (!factor) {
      setBusy(false);
      setError("We couldn't find your authenticator app on this account. Reload the page.");
      return;
    }
    const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code: cleanMfaCode(code) });
    if (verifyError) {
      setBusy(false);
      setError("That code didn't work. Check the code your app shows now and try again.");
      return;
    }
    window.location.assign(next);
  }

  return (
    <form onSubmit={submit} className="space-y-4 text-left">
      <label htmlFor="mfa-code" className="block text-sm text-slate-800 dark:text-slate-200">
        Type the 6-digit code from your authenticator app:
      </label>
      <input
        id="mfa-code"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        inputMode="numeric"
        autoComplete="one-time-code"
        autoFocus
        maxLength={MFA_CODE_LENGTH + 1}
        className="w-44 rounded-md border border-slate-300 bg-white px-3 py-2 font-mono text-lg tracking-widest dark:border-slate-600 dark:bg-slate-900"
      />
      <div role="status" className="min-h-[1.25rem] text-sm text-red-600 dark:text-red-400">
        {error}
      </div>
      <button
        type="submit"
        disabled={busy || cleanMfaCode(code).length !== MFA_CODE_LENGTH}
        data-track="mfa-challenge"
        className="rounded-md bg-plum-600 px-4 py-2 text-sm font-medium text-white hover:bg-plum-700 disabled:opacity-50"
      >
        {busy ? "Checking…" : "Continue"}
      </button>
      <p className="text-sm text-slate-600 dark:text-slate-400">
        Lost your phone? Email{" "}
        <a href={`mailto:${helpEmail}`} className="text-plum-600 hover:underline dark:text-plum-400">
          {helpEmail}
        </a>{" "}
        and we&apos;ll reset it for you.
      </p>
      <div className="border-t border-slate-200 pt-4 dark:border-slate-800">
        <SignOutButton />
      </div>
    </form>
  );
}
