"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import Modal from "@/components/Modal";
import { loadRecentSignIn, sendReauthCode, verifyReauthCode } from "./identityActions";

/**
 * "Confirm it's you" before a sensitive change (switching the primary email). There is no password to
 * re-enter, so it is a fresh sign-in: a link and a code go to the address they sign in with. Typing the code
 * here finishes it; opening the link instead works too, and coming back to this tab finishes it as well.
 * `onVerified` runs once, when they have signed in again.
 */
export default function ReauthModal({ isOpen, onClose, onVerified }: { isOpen: boolean; onClose: () => void; onVerified: () => void }) {
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const finished = useRef(false);

  const finish = useCallback(() => {
    if (finished.current) return;
    finished.current = true;
    onVerified();
  }, [onVerified]);

  const send = useCallback(async () => {
    setBusy(true);
    setError(null);
    const result = await sendReauthCode();
    if ("error" in result) setError(result.error);
    else setSentTo(result.sentTo);
    setBusy(false);
  }, []);

  // One email when the modal opens.
  useEffect(() => {
    if (!isOpen) return;
    finished.current = false;
    setCode("");
    setSentTo(null);
    void send();
  }, [isOpen, send]);

  // Opening the link in the email signs them in (maybe in another tab); when they come back here, carry on.
  useEffect(() => {
    if (!isOpen) return;
    const check = async () => {
      if (document.visibilityState !== "visible") return;
      if ((await loadRecentSignIn()).recent) finish();
    };
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    return () => {
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, [isOpen, finish]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!code.trim()) return;
    setBusy(true);
    setError(null);
    const result = await verifyReauthCode(code);
    setBusy(false);
    if ("error" in result) setError(result.error);
    else finish();
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Confirm it's you" maxWidth="md">
      <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">
        {sentTo ? (
          <>
            We emailed a sign-in code to <span className="font-medium break-all">{sentTo}</span>. Enter it here, or open the link in
            that email and come back to this tab.
          </>
        ) : (
          "Sending a sign-in code to your email…"
        )}
      </p>
      <form onSubmit={handleSubmit} className="space-y-3">
        <input
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          aria-label="Sign-in code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="Code from the email"
          className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-sm tracking-widest"
          maxLength={12}
        />
        {error && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            data-track="settings-identity-reauth-resend"
            onClick={() => void send()}
            disabled={busy}
            className="text-sm text-plum-700 dark:text-plum-300 hover:underline disabled:opacity-50"
          >
            Send a new code
          </button>
          <button
            type="submit"
            data-track="settings-identity-reauth-confirm"
            disabled={busy || !code.trim()}
            className="px-4 py-2 bg-plum-600 text-white text-sm rounded-md hover:bg-plum-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Confirm
          </button>
        </div>
      </form>
    </Modal>
  );
}
