import type { Metadata } from "next";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { SUPPORT_EMAIL } from "@/lib/config";
import { COMPLIANCE_EFFECTIVE, COMPLIANCE_GROUPS, COMPLIANCE_PROVIDERS, COMPLIANCE_STATUSES, type ComplianceStatus } from "@/content/compliance";
import { RichText, StatusLegend, TrustAside, TrustCard, TrustNav, TrustSection } from "@/components/trust/Trust";

export const metadata: Metadata = {
  title: "Compliance",
};

/**
 * The laws, standards and frameworks the Hub follows, relies on a provider for, or is working toward.
 * Public like `/privacy`: anyone can read it. The list lives in `content/compliance.ts`, and every line must
 * be true of the code, so change them together.
 */
export default async function CompliancePage() {
  const user = await getCurrentUser();

  return (
    <div className="min-h-screen bg-canvas dark:bg-slate-950">
      <div className="container mx-auto px-6 py-6 max-w-5xl">
        <p className="mb-4 text-sm">
          <Link href={user ? "/dashboard" : "/login"} className="text-plum-700 dark:text-plum-300 underline">
            {user ? "Back to the Hub" : "Sign in to the Hub"}
          </Link>
        </p>
        <h1 className="text-2xl font-bold mb-1">Compliance</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400 mb-1">
          The laws, standards and frameworks we follow, the ones a provider handles for us, and the ones we are still working toward.
        </p>
        <p className="text-sm text-slate-600 dark:text-slate-400 mb-6">
          Effective <time dateTime={COMPLIANCE_EFFECTIVE}>{COMPLIANCE_EFFECTIVE}</time>.
        </p>

        <TrustAside title="How to read this page">
          <p className="mb-2">
            We say what we do, not that we hold a certificate we don&apos;t. Where a provider holds the certification (for
            example, our payment provider for card payments), the row says so. Where we haven&apos;t finished or haven&apos;t looked yet, it says that too.
          </p>
          <StatusLegend statuses={Object.keys(COMPLIANCE_STATUSES) as ComplianceStatus[]} />
        </TrustAside>

        <TrustNav links={[...COMPLIANCE_GROUPS.map((g) => ({ id: g.id, title: g.title })), { id: "providers", title: "Services we rely on" }]} />

        {COMPLIANCE_GROUPS.map((group) => (
          <TrustSection key={group.id} id={group.id} title={group.title}>
            <p className="text-sm">
              <RichText text={group.intro} />
            </p>
            <ul className="space-y-3">
              {group.items.map((item) => (
                <TrustCard key={item.name} title={item.name} status={item.status} about={item.about}>
                  <p>
                    <RichText text={item.detail} />
                  </p>
                </TrustCard>
              ))}
            </ul>
          </TrustSection>
        ))}

        <TrustSection id="providers" title="Services we rely on">
          <p className="text-sm">
            Some of the above rests on the services the Hub is built on, described here by what they do. The{" "}
            <Link href="/privacy#services" className="underline">
              Privacy page
            </Link>{" "}
            lists all of them and what they receive.
          </p>
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-700 text-left">
                <th className="py-2 pr-4 font-semibold">What it does</th>
                <th className="py-2 font-semibold">What it covers</th>
              </tr>
            </thead>
            <tbody className="align-top">
              {COMPLIANCE_PROVIDERS.map((provider) => (
                <tr key={provider.role} className="border-b border-slate-100 dark:border-slate-800">
                  <td className="py-2 pr-4 font-medium text-slate-900 dark:text-slate-100">{provider.role}</td>
                  <td className="py-2">
                    <RichText text={provider.covers} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TrustSection>

        <p className="mb-10 text-sm text-slate-700 dark:text-slate-300">
          Questions, or something here that doesn&apos;t look right? Email{" "}
          <a href={`mailto:${SUPPORT_EMAIL}`} className="underline">
            {SUPPORT_EMAIL}
          </a>
          . This page describes what we do. It is not legal advice and not a certificate.
        </p>
      </div>
    </div>
  );
}
