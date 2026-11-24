"use client";

import { useEffect, useState, type FormEvent } from "react";
import { safeHref } from "@/lib/landing/data";
import { OPT_IN_DONE_EVENT, publicSlugOf } from "@/lib/landing/exit-popup";
import { rememberSignUp } from "@/lib/landing/popup-memory";

export type OptInFormProps = {
  /** The form the sign-up goes to in Kajabi. */
  kajabiFormId: string;
  /** Where Kajabi keeps the Instagram handle; "none" leaves the question out. */
  instagramField: "none" | "custom_1" | "custom_2" | "custom_3";
  buttonLabel: string;
  reassurance?: string;
  successMessage?: string;
  /** A thank-you page to go to instead of showing `successMessage`. */
  href?: string;
  /** Button classes, from the Button block's look, so the two match (blocks.tsx passes them in). */
  buttonClass?: string;
};

const INPUT =
  "mt-1 block w-full rounded-md border border-ink-muted bg-card px-3 py-2 text-base text-ink placeholder:text-ink-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-plum-600";

/** The page's address, read in the browser: the relay finds the form in the published page by it. Null in the editor and the preview. */
const publicSlug = (): string | null => publicSlugOf(window.location.pathname);

/**
 * A sign-up form: name, email and, when the block asks, an Instagram handle. It posts to our relay
 * (`/api/landing/opt-in`), never to Kajabi from the browser, so no form id leaves the page data except as a field of
 * our own request. The hidden `website` field is the honeypot. In the editor and the preview nothing is sent.
 * Nothing the visitor types goes to analytics or the console.
 */
export default function OptInForm({ kajabiFormId, instagramField, buttonLabel, reassurance, successMessage, href, buttonClass }: OptInFormProps) {
  const [slug, setSlug] = useState<string | null | undefined>(undefined);
  const [state, setState] = useState<"idle" | "sending" | "done">("idle");
  const [error, setError] = useState("");

  useEffect(() => setSlug(publicSlug()), []);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state === "sending" || !slug) return;
    const form = new FormData(event.currentTarget);
    setState("sending");
    setError("");
    try {
      const response = await fetch("/api/landing/opt-in", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          page: slug,
          formId: kajabiFormId,
          name: form.get("name"),
          email: form.get("email"),
          instagram: form.get("instagram") ?? "",
          website: form.get("website") ?? "",
        }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error || "We couldn't sign you up just now. Please try again in a little while.");
        setState("idle");
        return;
      }
      // A popup that holds this form leaves this visitor alone from now on (kept only where consent allows).
      rememberSignUp(kajabiFormId.trim());
      const next = safeHref(href);
      if (next) {
        window.location.assign(next);
        return;
      }
      setState("done");
      // Tells an exit popup on this page that the visitor has signed up, so it stops asking. Carries nothing about them.
      window.dispatchEvent(new Event(OPT_IN_DONE_EVENT));
    } catch {
      setError("We couldn't sign you up just now. Please check your connection and try again.");
      setState("idle");
    }
  }

  if (state === "done") {
    return (
      <p role="status" className="py-4 text-center text-lg font-medium">
        {successMessage || "Thank you! Please check your email."}
      </p>
    );
  }

  return (
    <form onSubmit={onSubmit} className="mx-auto my-3 max-w-md space-y-4 text-left">
      <div>
        <label htmlFor={`optin-name-${kajabiFormId}`} className="block text-sm font-medium">
          Name
        </label>
        <input id={`optin-name-${kajabiFormId}`} name="name" type="text" required autoComplete="name" maxLength={200} className={INPUT} />
      </div>
      <div>
        <label htmlFor={`optin-email-${kajabiFormId}`} className="block text-sm font-medium">
          Email
        </label>
        <input id={`optin-email-${kajabiFormId}`} name="email" type="email" required autoComplete="email" maxLength={254} className={INPUT} />
      </div>
      {instagramField !== "none" && (
        <div>
          <label htmlFor={`optin-instagram-${kajabiFormId}`} className="block text-sm font-medium">
            Instagram handle (if you have one)
          </label>
          <input id={`optin-instagram-${kajabiFormId}`} name="instagram" type="text" autoComplete="off" maxLength={80} placeholder="@yourname" className={INPUT} />
        </div>
      )}
      {/* The honeypot: out of sight and out of the tab order; only a bot fills it. */}
      <div aria-hidden="true" className="absolute -left-[10000px] h-0 w-0 overflow-hidden">
        <label>
          Leave this empty
          <input name="website" type="text" tabIndex={-1} autoComplete="off" />
        </label>
      </div>
      <div className="text-center">
        <button type="submit" disabled={state === "sending" || !slug} className={`${buttonClass ?? "rounded-full bg-plum-600 px-6 py-3 font-semibold text-white"} disabled:opacity-60`}>
          {state === "sending" ? "Sending…" : buttonLabel || "Sign me up"}
        </button>
      </div>
      {error && (
        <p role="alert" className="text-center text-sm font-medium">
          {error}
        </p>
      )}
      {slug === null && <p className="text-center text-sm opacity-80">Preview: nothing is sent from here.</p>}
      {reassurance && <p className="text-center text-sm opacity-80">{reassurance}</p>}
    </form>
  );
}
