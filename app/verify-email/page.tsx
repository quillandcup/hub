import type { Metadata } from "next";
import Link from "next/link";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { lookupVerificationToken } from "@/lib/email-verification";
import { SUPPORT_EMAIL } from "@/lib/config";
import { createRepos } from "@/lib/data/repos";
import { confirmEmailFromToken } from "./actions";

export const metadata: Metadata = { title: "Confirm your email" };

// Where the link in a verification email lands. Public (no sign-in; the proxy lets it through): the signed
// token in ?t= names one email alias. Viewing never changes anything, since link scanners open every link in
// an email; only the button does.
export default async function VerifyEmailPage({ searchParams }: { searchParams: Promise<{ t?: string }> }) {
  const { t } = await searchParams;
  const found = await lookupVerificationToken(createRepos(createServiceRoleClient()), t);

  if (found.state === "invalid" || found.state === "expired") {
    return (
      <Shell>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100 mb-3">
          {found.state === "expired" ? "This link has expired" : "This link doesn't work"}
        </h1>
        <p className="text-slate-600 dark:text-slate-400 mb-6">
          {found.state === "expired" ? "Ask for a new one" : "It may have been cut off when copied, or the address was changed. Ask for a new one"} in your
          identity settings, or email{" "}
          <a href={`mailto:${SUPPORT_EMAIL}`} className="text-plum-600 dark:text-plum-400 hover:underline">
            {SUPPORT_EMAIL}
          </a>
          .
        </p>
        <SettingsLink />
      </Shell>
    );
  }

  const address = found.alias.aliasEmail;
  if (found.state === "verified") {
    return (
      <Shell>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100 mb-3">{address} is confirmed</h1>
        <p className="text-slate-600 dark:text-slate-400 mb-6">
          You can switch to it as your primary email any time in your identity settings.
        </p>
        <SettingsLink />
      </Shell>
    );
  }

  return (
    <Shell>
      <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100 mb-3">Is this your email address?</h1>
      <p className="text-slate-600 dark:text-slate-400 mb-6">
        Confirm that <span className="font-medium break-all">{address}</span> is yours.
      </p>
      <form action={confirmEmailFromToken} className="mb-6">
        <input type="hidden" name="token" value={t} />
        <button type="submit" className="px-4 py-2 rounded-md bg-plum-600 text-white hover:bg-plum-700 transition-colors">
          Confirm this address
        </button>
      </form>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-canvas dark:bg-slate-950 flex items-center justify-center px-4">
      <div className="max-w-md w-full bg-white dark:bg-slate-900 rounded-lg shadow p-8 text-center">{children}</div>
    </div>
  );
}

function SettingsLink() {
  return (
    <Link href="/settings/identity" className="text-plum-600 dark:text-plum-400 hover:underline">
      Identity settings
    </Link>
  );
}
