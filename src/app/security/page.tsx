import type { Metadata } from "next";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { SUPPORT_EMAIL } from "@/lib/config";
import { SECURITY_EFFECTIVE, SECURITY_GROUPS, SECURITY_STATUSES } from "@/content/security";
import { RichText, StatusLegend, TrustAside, TrustCard, TrustNav, TrustSection } from "@/components/trust/Trust";

export const metadata: Metadata = {
  title: "Security",
};

/**
 * How the Hub keeps its members' information safe, in plain words. Public like `/privacy`. The list lives in
 * `src/content/security.ts`, which the staff page (`/admin/security`) reads too, so the two cannot drift; every line
 * must be true of the code, so change them together.
 */
export default async function SecurityPage() {
  const user = await getCurrentUser();

  return (
    <div className="min-h-screen bg-canvas dark:bg-slate-950">
      <div className="container mx-auto px-6 py-6 max-w-5xl">
        <p className="mb-4 text-sm">
          <Link href={user ? "/dashboard" : "/login"} className="text-plum-700 dark:text-plum-300 underline">
            {user ? "Back to the Hub" : "Sign in to the Hub"}
          </Link>
        </p>
        <h1 className="text-2xl font-bold mb-1">Security</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400 mb-1">
          How we keep the Hub, and what is in it, safe.
        </p>
        <p className="text-sm text-slate-600 dark:text-slate-400 mb-6">
          Effective <time dateTime={SECURITY_EFFECTIVE}>{SECURITY_EFFECTIVE}</time>.
        </p>

        <TrustAside title="How to read this page">
          <p className="mb-2">
            Each line says what we do and whether it is finished. Where something is still in progress, we say so. What we
            collect and who can see it is on the{" "}
            <Link href="/privacy" className="underline">
              Privacy page
            </Link>
            , and the standards we follow are on the{" "}
            <Link href="/compliance" className="underline">
              Compliance page
            </Link>
            .
          </p>
          <StatusLegend statuses={SECURITY_STATUSES} />
        </TrustAside>

        <TrustNav links={[...SECURITY_GROUPS.map((g) => ({ id: g.id, title: g.title })), { id: "report", title: "Found a problem?" }]} />

        {SECURITY_GROUPS.map((group) => (
          <TrustSection key={group.id} id={group.id} title={group.title}>
            <p className="text-sm">
              <RichText text={group.intro} />
            </p>
            <ul className="space-y-3">
              {group.items.map((item) => (
                <TrustCard key={item.id} title={item.title} status={item.status}>
                  <p>
                    <RichText text={item.member} />
                  </p>
                </TrustCard>
              ))}
            </ul>
          </TrustSection>
        ))}

        <TrustSection id="report" title="Found a problem?">
          <p className="text-sm">
            If you think you have found a security problem, or something looks wrong with your account, email{" "}
            <a href={`mailto:${SUPPORT_EMAIL}`} className="underline">
              {SUPPORT_EMAIL}
            </a>{" "}
            and tell us what you saw. Please don&apos;t post it in a public channel. This page describes what we do. It is not a
            guarantee.
          </p>
        </TrustSection>
      </div>
    </div>
  );
}
