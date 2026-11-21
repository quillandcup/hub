"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import ConfirmDialog from "@/components/ConfirmDialog";
import { STAFF_MFA_FACTOR_TYPE } from "@/lib/staff-mfa";
import { MFA_ISSUER } from "@/lib/config";
import { MFA_CODE_LENGTH, cleanMfaCode } from "@/lib/mfa-code";

/**
 * Two-step sign-in: the account's authenticator app (a TOTP factor), set up and removed here (docs/trust/STAFF_MFA.md). It is in
 * Settings for every member and is the page staff are sent to when it is required (/mfa). Supabase Auth's MFA calls need the
 * signed-in browser session, so they are made from the browser client; setting it up leaves the session at the second level
 * (aal2) and the browser client stores the new token itself.
 *
 * `afterEnrol` is where to go once it is on (the page a staff member was headed to); without it the panel stays and refreshes.
 * `staff` only changes the wording of the remove confirmation.
 */
type Factor = { id: string; friendly_name?: string; created_at: string };
type Enrolment = { factorId: string; qrCode: string; secret: string };

const FRIENDLY_NAME = "Authenticator app";
const BUTTON = "rounded-md px-3 py-1.5 text-sm font-medium disabled:opacity-50";
const PRIMARY = `${BUTTON} bg-plum-600 text-white hover:bg-plum-700`;
const SECONDARY = `${BUTTON} border border-slate-300 text-slate-800 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-100 dark:hover:bg-slate-800`;

export default function MfaPanel({ afterEnrol, staff = false }: { afterEnrol?: string; staff?: boolean }) {
  const router = useRouter();
  const [factors, setFactors] = useState<Factor[] | null>(null);
  const [enrolment, setEnrolment] = useState<Enrolment | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [removing, setRemoving] = useState<Factor | null>(null);

  const load = useCallback(async () => {
    const { data, error: listError } = await createClient().auth.mfa.listFactors();
    if (listError || !data) {
      setError("We couldn't load your two-step sign-in. Reload the page to try again.");
      setFactors([]);
      return;
    }
    setFactors(data.totp.map((f) => ({ id: f.id, friendly_name: f.friendly_name, created_at: f.created_at })));
  }, []);

  useEffect(() => {
    // Reads the account's factors once on open; the state it sets is what the panel then shows.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function startEnrol() {
    setBusy(true);
    setError(null);
    setMessage(null);
    const supabase = createClient();
    // A set-up that was started and never finished leaves an unverified factor behind, and a second one with the same name is
    // refused. It never counted for anything, so clear it first.
    const { data: existing } = await supabase.auth.mfa.listFactors();
    for (const stale of existing?.all.filter((f) => f.factor_type === STAFF_MFA_FACTOR_TYPE && f.status === "unverified") ?? []) {
      await supabase.auth.mfa.unenroll({ factorId: stale.id });
    }
    const { data, error: enrolError } = await supabase.auth.mfa.enroll({ factorType: STAFF_MFA_FACTOR_TYPE, friendlyName: FRIENDLY_NAME, issuer: MFA_ISSUER });
    setBusy(false);
    if (enrolError || !data) {
      setError("We couldn't start the set-up. Try again in a moment.");
      return;
    }
    setCode("");
    setEnrolment({ factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret });
  }

  async function confirmEnrol(e: FormEvent) {
    e.preventDefault();
    if (!enrolment) return;
    setBusy(true);
    setError(null);
    const { error: verifyError } = await createClient().auth.mfa.challengeAndVerify({ factorId: enrolment.factorId, code: cleanMfaCode(code) });
    setBusy(false);
    if (verifyError) {
      setError("That code didn't work. Check the code your app shows now and try again.");
      return;
    }
    setEnrolment(null);
    setCode("");
    setMessage("Two-step sign-in is on. You'll enter a code from your app when you sign in.");
    await load();
    if (afterEnrol) {
      // A full navigation: the server has to see the new session cookie before it lets the visitor into the admin area.
      window.location.assign(afterEnrol);
      return;
    }
    router.refresh();
  }

  async function cancelEnrol() {
    const pending = enrolment;
    setEnrolment(null);
    setCode("");
    setError(null);
    if (pending) await createClient().auth.mfa.unenroll({ factorId: pending.factorId });
  }

  async function removeFactor(factor: Factor): Promise<string | void> {
    const supabase = createClient();
    const { error: removeError } = await supabase.auth.mfa.unenroll({ factorId: factor.id });
    if (removeError) return "We couldn't remove it. Reload the page and try again.";
    // The session's level drops back with the factor; refreshing makes the stored token say so.
    await supabase.auth.refreshSession();
    setMessage("Two-step sign-in is off.");
    await load();
    router.refresh();
  }

  const enrolled = factors?.[0] ?? null;

  return (
    <div>
      <h2 id="two-step-sign-in" className="mb-2 text-lg font-medium text-slate-900 dark:text-slate-100">
        Two-step sign-in
      </h2>
      <p className="mb-4 text-sm text-slate-600 dark:text-slate-400">
        An extra check when you sign in: after the link or code we email you, you also type a 6-digit code from an authenticator app on your phone. It
        keeps your account safe even if someone gets into your email.
      </p>

      <div role="status" className="mb-2 min-h-[1.25rem] text-sm">
        {error && <span className="text-red-600 dark:text-red-400">{error}</span>}
        {!error && message && <span className="text-green-700 dark:text-green-400">{message}</span>}
      </div>

      {factors === null && <div className="h-12 animate-pulse rounded-md bg-slate-200 dark:bg-slate-700" />}

      {factors !== null && enrolment === null && enrolled === null && (
        <button type="button" onClick={startEnrol} disabled={busy} data-track="mfa-start" className={PRIMARY}>
          {busy ? "Starting…" : "Set up two-step sign-in"}
        </button>
      )}

      {enrolment && (
        <form onSubmit={confirmEnrol} className="max-w-md space-y-4">
          <ol className="list-decimal space-y-3 pl-5 text-sm text-slate-800 dark:text-slate-200">
            <li>
              Open an authenticator app (such as Google Authenticator, Authy or 1Password) and scan this picture.
              {/* A data: SVG from Supabase Auth; next/image can't optimise it. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={enrolment.qrCode} alt="QR code to scan with your authenticator app" className="mt-2 aspect-square w-full max-w-xs rounded-md bg-white p-3" />
            </li>
            <li>
              Can&apos;t scan it? Type this key into your app instead:
              <code className="mt-1 block break-all rounded-md bg-slate-100 px-3 py-2 font-mono text-sm dark:bg-slate-800" data-testid="mfa-secret">
                {enrolment.secret}
              </code>
            </li>
            <li>
              <label htmlFor="mfa-enrol-code" className="block">
                Type the 6-digit code your app shows now:
              </label>
              <input
                id="mfa-enrol-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={MFA_CODE_LENGTH + 1}
                className="mt-1 w-40 rounded-md border border-slate-300 bg-white px-3 py-2 font-mono text-lg tracking-widest dark:border-slate-600 dark:bg-slate-900"
              />
            </li>
          </ol>
          <div className="flex gap-2">
            <button type="submit" disabled={busy || cleanMfaCode(code).length !== MFA_CODE_LENGTH} data-track="mfa-confirm" className={PRIMARY}>
              {busy ? "Checking…" : "Turn on"}
            </button>
            <button type="button" onClick={cancelEnrol} disabled={busy} className={SECONDARY}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {enrolled && enrolment === null && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-slate-200 px-3 py-3 dark:border-slate-700">
          <div className="text-sm">
            <div className="text-slate-900 dark:text-slate-100">{enrolled.friendly_name || FRIENDLY_NAME}</div>
            <div className="text-slate-600 dark:text-slate-400">Added {new Date(enrolled.created_at).toLocaleDateString(undefined, { dateStyle: "medium" })}</div>
          </div>
          <button type="button" onClick={() => setRemoving(enrolled)} data-track="mfa-remove" className={SECONDARY}>
            Remove
          </button>
        </div>
      )}

      <ConfirmDialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        title="Remove two-step sign-in?"
        body={
          staff
            ? "You'll sign in with just your email link or code again. Staff accounts need two-step sign-in, so you'll be asked to set it up again before you can use the admin pages."
            : "You'll sign in with just your email link or code again. You can set it up again any time."
        }
        confirmLabel="Remove"
        tone="danger"
        onConfirm={() => (removing ? removeFactor(removing) : undefined)}
      />
    </div>
  );
}
