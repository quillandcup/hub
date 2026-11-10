"use client";

import { useEffect, useState, useTransition } from "react";
import { flushSync } from "react-dom";
import { signInWithSlackCode } from "@/app/auth/slack/actions";
import { formatSlackSignInCode, normalizeSlackSignInCode, SLACK_CODE_LENGTH } from "@/lib/slack-sign-in-code";
import { classifyCode } from "@/lib/sign-in-code";
import { verifyEmailCode } from "./actions";

/**
 * The one place to enter a sign-in code, for both ways in: the code from the sign-in email (typed
 * with the address above) and the link or code from Slack (copied out of Slack into a browser that
 * doesn't share Slack's in-app browser's cookies, like Safari on iPhone). It works out which it was
 * from the shape (lib/sign-in-code.ts) and sends it down that path: a Slack link or code signs in as
 * soon as it is complete, an email code with the button. Folded away until asked for, unless the
 * page already expects one (a link was just sent, or they arrived from an email that carries a code).
 */
export default function CodeEntry({ email, open, fromSlack }: { email: string; open: boolean; fromSlack: boolean }) {
  const [expanded, setExpanded] = useState(open);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (open) setExpanded(true);
  }, [open]);

  /** Sign in with whatever is in `text`. Returns whether it held a code. */
  function submit(text: string, { requireEmail = true }: { requireEmail?: boolean } = {}): boolean {
    const parsed = classifyCode(text);
    if (!parsed) return false;
    setError(null);

    if (parsed.kind === "slack_link") {
      // Only the token is taken from the pasted link; we always go to our own route. A full document
      // navigation on purpose: /auth/slack signs in only on a real navigation (Sec-Fetch-Mode:
      // navigate), which router.push() wouldn't be.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign(`/auth/slack?token=${encodeURIComponent(parsed.token)}`);
      return true;
    }
    if (parsed.kind === "slack_code") {
      flushSync(() => setValue(formatSlackSignInCode(parsed.code)));
      startTransition(async () => {
        const data = new FormData();
        data.set("code", formatSlackSignInCode(parsed.code));
        const result = await signInWithSlackCode(null, data);
        if (result?.error) setError(result.error);
      });
      return true;
    }
    if (requireEmail && !email.trim()) {
      setError("Enter your email address above first, then the code.");
      return true;
    }
    startTransition(async () => {
      const result = await verifyEmailCode(email, parsed.code);
      if (result?.error) setError(result.error);
    });
    return true;
  }

  function handlePaste(e: React.ClipboardEvent<HTMLInputElement>) {
    const text = e.clipboardData.getData("text");
    if (classifyCode(text)) {
      e.preventDefault();
      setValue(text.trim());
      submit(text);
    }
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const next = e.target.value;
    setValue(next);
    // Typed by hand: a Slack code signs in as soon as it is complete. An email code waits for the
    // button, since its length depends on how the project is set up.
    if (!pending && normalizeSlackSignInCode(next).length === SLACK_CODE_LENGTH) submit(next);
  }

  async function pasteFromClipboard() {
    try {
      const text = await navigator.clipboard.readText();
      if (!submit(text)) setError("There's no sign-in code or link on your clipboard.");
    } catch {
      setError("Couldn't read your clipboard. Long-press the box and choose Paste.");
    }
  }

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="w-full text-center text-sm text-plum-700 dark:text-plum-300 hover:underline"
      >
        Have a code?
      </button>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!submit(value)) setError("That doesn't look like a sign-in code. Check it and try again.");
      }}
      className="space-y-2"
    >
      <label htmlFor="sign-in-code" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
        Sign-in code
      </label>
      <p className="text-sm text-slate-600 dark:text-slate-400">
        {fromSlack ? "From the email, or from Slack." : "From the email."}
      </p>
      <div className="flex gap-2">
        <input
          id="sign-in-code"
          type="text"
          inputMode="text"
          value={value}
          onChange={handleChange}
          onPaste={handlePaste}
          autoComplete="one-time-code"
          autoCapitalize="characters"
          spellCheck={false}
          placeholder={fromSlack ? "123456 or ABCDE-12345" : "123456"}
          className="min-w-0 flex-1 px-4 py-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 font-mono tracking-wider focus:outline-none focus:ring-2 focus:ring-plum-500"
        />
        <button
          type="button"
          onClick={pasteFromClipboard}
          disabled={pending}
          aria-label="Paste a code or link"
          className="px-5 py-3 border border-plum-600 text-plum-700 dark:text-plum-300 disabled:opacity-50 font-semibold rounded-lg transition-colors hover:bg-plum-50 dark:hover:bg-slate-800"
        >
          Paste
        </button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-300">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={pending || value.trim() === ""}
        className="w-full px-6 py-3 border border-plum-600 text-plum-700 dark:text-plum-300 hover:bg-plum-50 dark:hover:bg-slate-800 disabled:opacity-50 font-semibold rounded-lg transition-colors"
      >
        {pending ? "Signing in…" : "Sign in with code"}
      </button>
    </form>
  );
}
