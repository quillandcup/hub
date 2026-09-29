"use client";

import { useActionState, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { signInWithSlackCode, type SlackCodeState } from "@/app/auth/slack/actions";
import {
  SLACK_CODE_LENGTH,
  extractSlackSignInCredential,
  formatSlackSignInCode,
  normalizeSlackSignInCode,
} from "@/lib/slack-sign-in-code";

/**
 * Sign in through the Hedgie Hub Slack app instead of waiting for an email. "Open Hedgie Hub in
 * Slack" deep-links to the app's Home tab (desktop and mobile), whose button signs in with one
 * click. For browsers other than the one Slack opens links in (Safari on iPhone, where Slack's
 * in-app browser keeps its own cookies), members paste the one-time link or code they copied from
 * Slack: a link signs in immediately, a code submits itself -- no second button to press.
 */
export default function SlackSignIn({ slackHomeUrl }: { slackHomeUrl: string }) {
  const [state, formAction, pending] = useActionState<SlackCodeState | null, FormData>(signInWithSlackCode, null);
  const [value, setValue] = useState("");
  const [hint, setHint] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  /** Act on pasted/typed text if it holds a credential. Returns whether it did. */
  function applyCredentialFrom(text: string): boolean {
    const credential = extractSlackSignInCredential(text);
    if (!credential) return false;
    setHint(null);

    if (credential.kind === "token") {
      // Only the token is taken from the pasted link; we always go to our own route. A full
      // document navigation on purpose: /auth/slack is a route handler that signs in only on a
      // real navigation (Sec-Fetch-Mode: navigate), which router.push() wouldn't be.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign(`/auth/slack?token=${encodeURIComponent(credential.token)}`);
      return true;
    }
    flushSync(() => setValue(formatSlackSignInCode(credential.code)));
    formRef.current?.requestSubmit();
    return true;
  }

  function handlePaste(e: React.ClipboardEvent<HTMLInputElement>) {
    if (applyCredentialFrom(e.clipboardData.getData("text"))) e.preventDefault();
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const next = e.target.value;
    setValue(next);
    // Typed by hand: submit as soon as the code is complete.
    if (!pending && normalizeSlackSignInCode(next).length === SLACK_CODE_LENGTH) applyCredentialFrom(next);
  }

  async function pasteFromClipboard() {
    try {
      const text = await navigator.clipboard.readText();
      if (!applyCredentialFrom(text)) setHint("There's no Hedgie Hub link or code on your clipboard. Copy it from Slack first.");
    } catch {
      setHint("Couldn't read your clipboard. Long-press the box below and choose Paste.");
    }
  }

  return (
    <div className="space-y-4">
      <a
        href={slackHomeUrl}
        className="flex w-full items-center justify-center px-6 py-3 border border-plum-600 text-plum-700 dark:text-plum-300 font-semibold rounded-lg transition-colors hover:bg-plum-50 dark:hover:bg-slate-800"
      >
        Open Hedgie Hub in Slack
      </a>
      <p className="text-sm text-slate-600 dark:text-slate-400 text-center">
        Then tap <strong>Open Hedgie Hub</strong> in the app&apos;s Home tab.
      </p>

      <form ref={formRef} action={formAction} className="space-y-3">
        <label htmlFor="slack-code" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
          Or paste the sign-in link or code from Slack
        </label>
        <button
          type="button"
          onClick={pasteFromClipboard}
          disabled={pending}
          className="w-full px-6 py-3 bg-plum-600 hover:bg-plum-700 disabled:bg-plum-400 text-white font-semibold rounded-lg transition-colors"
        >
          {pending ? "Signing in…" : "Paste from Slack"}
        </button>
        <div className="flex gap-2">
          <input
            id="slack-code"
            name="code"
            type="text"
            value={value}
            onChange={handleChange}
            onPaste={handlePaste}
            autoComplete="one-time-code"
            autoCapitalize="characters"
            spellCheck={false}
            placeholder="ABCDE-12345"
            required
            className="min-w-0 flex-1 px-4 py-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 font-mono tracking-wider focus:outline-none focus:ring-2 focus:ring-plum-500"
          />
          <button
            type="submit"
            disabled={pending}
            className="px-5 py-3 border border-plum-600 text-plum-700 dark:text-plum-300 disabled:opacity-50 font-semibold rounded-lg transition-colors"
          >
            Sign in
          </button>
        </div>
        {(hint || state?.error) && (
          <p role="alert" className="text-sm text-red-700 dark:text-red-300">
            {hint ?? state?.error}
          </p>
        )}
      </form>
    </div>
  );
}
