import type { Metadata } from "next";
import Link from "next/link";
import { parseConfirmParams } from "@/lib/auth-confirm";

export const metadata: Metadata = {
  title: "Continue to Hedgie Hub",
  robots: { index: false, follow: false },
  // The URL carries the one-time token; never leak it in a Referer header.
  referrer: "no-referrer",
};

const COPY = {
  invite: { lead: "Accept your invitation", button: "Accept invitation" },
  recovery: { lead: "Reset your password", button: "Continue" },
  email: { lead: "Signing in", button: "Continue to Hedgie Hub" },
} as const;

/**
 * Where /auth/confirm sends a visit that didn't look like a plain browser navigation (a link checker,
 * a prefetcher, a client that sends no Sec-Fetch headers). Rendering never spends the token: the button
 * posts it to /auth/confirm, which does. A real member clicking the email link never lands here.
 */
export default async function ConfirmContinuePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const params = parseConfirmParams({ get: (name: string) => first(query[name]) });
  const copy = params?.type === "invite" ? COPY.invite : params?.type === "recovery" ? COPY.recovery : COPY.email;

  return (
    <div className="min-h-screen bg-canvas dark:bg-slate-950 flex items-center justify-center px-6">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-plum-600 dark:text-plum-400 mb-2">Hedgie Hub</h1>
          <p className="text-slate-600 dark:text-slate-400">{copy.lead}</p>
        </div>

        <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-lg p-8 space-y-6">
          {params ? (
            <form action="/auth/confirm" method="post" className="space-y-4">
              <input type="hidden" name="token_hash" value={params.tokenHash} />
              <input type="hidden" name="type" value={params.type} />
              {params.next && <input type="hidden" name="next" value={params.next} />}
              <button
                type="submit"
                className="w-full px-6 py-3 bg-plum-600 hover:bg-plum-700 text-white font-semibold rounded-lg transition-colors"
              >
                {copy.button}
              </button>
              <p className="text-sm text-slate-600 dark:text-slate-400 text-center">
                This button works once. You can also type the code from the email on the sign-in page.
              </p>
            </form>
          ) : (
            <>
              <div className="p-4 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300">
                This link isn&apos;t complete. Open it again from the email, or sign in with the code in the email.
              </div>
              <Link
                href="/login?mode=code"
                className="block w-full text-center px-6 py-3 bg-plum-600 hover:bg-plum-700 text-white font-semibold rounded-lg transition-colors"
              >
                Sign in with a code
              </Link>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
